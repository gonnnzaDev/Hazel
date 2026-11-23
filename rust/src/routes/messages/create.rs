use chrono::Duration as ChronoDuration;

use axum::extract::Path as AxumPath;

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::events::queue_event;
use crate::state::AppState;

use super::*;

pub(crate) async fn create_message(
    State(state): State<Arc<AppState>>,
    AxumPath(raw_channel): AxumPath<String>,
    AuthMember(member): AuthMember,
    JsonBody(payload): JsonBody<MessageCreate>,
) -> ApiResult<(StatusCode, Json<MessageRead>)> {
    let channel_id = path_uuid(&raw_channel)?;
    let channel = reachable_channel(&state, member.server_id, channel_id).await?;
    if payload.content.is_empty() {
        return Err(ApiError::request_validation(
            json!([{"loc":["body","content"]}]),
        ));
    }
    if !payload.attachments.is_empty() {
        return Err(ApiError::request_validation(
            json!([{"loc":["body","attachments"]}]),
        ));
    }
    enforce_size(&payload.content, state.settings.max_message_bytes)?;
    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM messages WHERE author_member_id = $1 AND created_at >= $2",
    )
    .bind(member.id)
    .bind(Utc::now() - ChronoDuration::seconds(60))
    .fetch_one(&state.pool)
    .await?;
    if recent >= state.settings.rate_limit_messages_per_minute {
        return Err(ApiError::new(
            429,
            "rate_limited",
            "Rate limited",
            format!(
                "Only {} messages per minute per nickname.",
                state.settings.rate_limit_messages_per_minute
            ),
        )
        .with("limit", state.settings.rate_limit_messages_per_minute));
    }

    let mut reply_to = None;
    if let Some(candidate) = payload.reply_to {
        let target: Option<(Uuid, Option<chrono::DateTime<chrono::Utc>>)> =
            sqlx::query_as("SELECT id, deleted_at FROM messages WHERE id = $1 AND channel_id = $2")
                .bind(candidate)
                .bind(channel_id)
                .fetch_optional(&state.pool)
                .await?;
        let Some((_, deleted_at)) = target else {
            return Err(ApiError::validation(
                "The message you reply to must exist in the same channel.",
            )
            .with("code", "reply_target_invalid")
            .with("reply_to", candidate.to_string()));
        };
        if deleted_at.is_some() {
            return Err(
                ApiError::validation("You cannot reply to a deleted message.")
                    .with("code", "reply_target_deleted")
                    .with("reply_to", candidate.to_string()),
            );
        }
        reply_to = Some(candidate);
    }

    let id = new_id();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        &format!(
            "INSERT INTO messages ({MESSAGE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, now())"
        ),
    )
    .bind(id)
    .bind(channel_id)
    .bind(&member.nickname)
    .bind(member.id)
    .bind(&payload.content)
    .bind(reply_to)
    .bind(json!([]))
    .execute(&mut *tx)
    .await?;
    // Leer dentro de la transacción: desde el pool todavía no se ve el INSERT.
    let row: MessageRow = sqlx::query_as(&format!(
        "SELECT {MESSAGE_COLUMNS} FROM messages WHERE id = $1"
    ))
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    let read = build_read(&state.pool, &row).await?;
    queue_event(
        &mut tx,
        "message.created",
        channel.server_id,
        Some(channel.id),
        serde_json::to_value(&read).unwrap_or(json!({})),
    )
    .await?;
    state.finish(tx).await?;
    Ok((StatusCode::CREATED, Json(read)))
}
