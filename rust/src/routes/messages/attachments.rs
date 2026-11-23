use axum::extract::Path as AxumPath;

use axum::extract::Multipart;

use std::path::Path as StdPath;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::json;
use uuid::Uuid;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn create_attachment(
    State(state): State<Arc<AppState>>,
    AxumPath(raw_channel): AxumPath<String>,
    AuthMember(member): AuthMember,
    multipart: Multipart,
) -> ApiResult<(StatusCode, Json<AttachmentRead>)> {
    let channel_id = path_uuid(&raw_channel)?;
    let _channel = reachable_channel(&state, member.server_id, channel_id).await?;
    let mut multipart = multipart;
    let mut message_raw: Option<String> = None;
    let mut filename = "attachment".to_string();
    let mut content_type = "application/octet-stream".to_string();
    let mut data: Vec<u8> = vec![];
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::request_validation(json!([{"msg": e.to_string()}])))?
    {
        match field.name() {
            Some("attachment_message_id") => {
                message_raw =
                    Some(field.text().await.map_err(|e| {
                        ApiError::request_validation(json!([{"msg": e.to_string()}]))
                    })?);
            }
            Some("file") => {
                filename = field.file_name().map(str::to_string).unwrap_or(filename);
                content_type = field
                    .content_type()
                    .map(str::to_string)
                    .unwrap_or(content_type);
                data = field
                    .bytes()
                    .await
                    .map_err(|e| ApiError::request_validation(json!([{"msg": e.to_string()}])))?
                    .to_vec();
            }
            _ => {}
        }
    }
    let message_id = path_uuid(&message_raw.unwrap_or_default())?;
    let message = load_message(&state.pool, message_id).await?;
    if message.channel_id != channel_id {
        return Err(
            ApiError::not_found("That message does not exist in this channel.")
                .with("code", "message_not_found")
                .with("message_id", message_id.to_string()),
        );
    }
    if data.len() > state.settings.max_attachment_bytes {
        return Err(ApiError::new(
            413,
            "attachment_too_large",
            "Attachment too large",
            format!(
                "Attachment is {} bytes; the limit is {}.",
                data.len(),
                state.settings.max_attachment_bytes
            ),
        )
        .with("max_bytes", state.settings.max_attachment_bytes as i64));
    }
    if !can_touch(&member, &message) {
        return Err(
            ApiError::forbidden("You cannot attach files to this message.")
                .with("code", "not_message_author"),
        );
    }
    let storage_key = format!("{}/{}/{}", member.server_id, message.id, filename);
    let path = StdPath::new(&state.settings.storage_root).join(&storage_key);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::internal(e.to_string()))?;
    }
    std::fs::write(&path, &data).map_err(|e| ApiError::internal(e.to_string()))?;
    let id = new_id();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO attachments (id, message_id, filename, content_type, size, storage_key, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
    )
    .bind(id)
    .bind(message.id)
    .bind(&filename)
    .bind(&content_type)
    .bind(data.len() as i32)
    .bind(&storage_key)
    .execute(&mut *tx)
    .await?;
    let mut attachments: Vec<String> = message
        .attachments
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    attachments.push(id.to_string());
    sqlx::query("UPDATE messages SET attachments = $2 WHERE id = $1")
        .bind(message.id)
        .bind(json!(attachments))
        .execute(&mut *tx)
        .await?;
    state.finish(tx).await?;
    let row = load_attachment(&state.pool, id).await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

pub(crate) async fn load_attachment(pool: &sqlx::PgPool, id: Uuid) -> ApiResult<AttachmentRow> {
    let row = sqlx::query_as::<_, AttachmentRow>(
        "SELECT id, message_id, filename, content_type, size, storage_key FROM attachments WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.ok_or_else(|| {
        ApiError::not_found("That attachment does not exist.")
            .with("code", "attachment_not_found")
            .with("attachment_id", id.to_string())
    })
}
