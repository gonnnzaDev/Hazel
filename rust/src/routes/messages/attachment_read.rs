use axum::extract::Path as AxumPath;
use axum::http::header;
use axum::http::HeaderValue;

use std::path::Path as StdPath;
use std::sync::Arc;

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn get_attachment(
    State(state): State<Arc<AppState>>,
    AxumPath(raw_id): AxumPath<String>,
    AuthMember(member): AuthMember,
) -> ApiResult<Response> {
    let id = path_uuid(&raw_id)?;
    let attachment = load_attachment(&state.pool, id).await?;
    let message = load_message(&state.pool, attachment.message_id).await?;
    let channel: Option<ChannelRow> = sqlx::query_as(&format!(
        "SELECT {CHANNEL_COLUMNS} FROM channels WHERE id = $1 AND server_id = $2"
    ))
    .bind(message.channel_id)
    .bind(member.server_id)
    .fetch_optional(&state.pool)
    .await?;
    if channel.is_none() {
        return Err(ApiError::not_found("That attachment does not exist.")
            .with("code", "attachment_not_found")
            .with("attachment_id", id.to_string()));
    }
    let path = StdPath::new(&state.settings.storage_root).join(&attachment.storage_key);
    let bytes = std::fs::read(&path).map_err(|_| {
        ApiError::not_found("That attachment does not exist.")
            .with("code", "attachment_not_found")
            .with("attachment_id", id.to_string())
    })?;
    let content_type = HeaderValue::from_str(&attachment.content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let disposition =
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", attachment.filename))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        bytes,
    )
        .into_response())
}

pub(crate) async fn delete_attachment(
    State(state): State<Arc<AppState>>,
    AxumPath(raw_id): AxumPath<String>,
    AuthMember(member): AuthMember,
) -> ApiResult<Response> {
    let id = path_uuid(&raw_id)?;
    let attachment = load_attachment(&state.pool, id).await?;
    let message = load_message(&state.pool, attachment.message_id).await?;
    let channel: Option<ChannelRow> = sqlx::query_as(&format!(
        "SELECT {CHANNEL_COLUMNS} FROM channels WHERE id = $1 AND server_id = $2"
    ))
    .bind(message.channel_id)
    .bind(member.server_id)
    .fetch_optional(&state.pool)
    .await?;
    if channel.is_none() {
        return Err(ApiError::not_found("That channel does not exist.")
            .with("code", "channel_not_found")
            .with("channel_id", message.channel_id.to_string()));
    }
    if !can_touch(&member, &message) {
        return Err(ApiError::forbidden("You cannot delete this attachment.")
            .with("code", "not_message_author"));
    }
    let path = StdPath::new(&state.settings.storage_root).join(&attachment.storage_key);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM attachments WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let attachments: Vec<String> = message
        .attachments
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .filter(|v| v != &id.to_string())
                .collect()
        })
        .unwrap_or_default();
    sqlx::query("UPDATE messages SET attachments = $2 WHERE id = $1")
        .bind(message.id)
        .bind(json!(attachments))
        .execute(&mut *tx)
        .await?;
    state.finish(tx).await?;
    Ok(no_content())
}
