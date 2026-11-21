use axum::extract::Path as AxumPath;

use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;
use axum::Json;
use serde_json::json;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::events::queue_event;
use crate::state::AppState;

use super::*;

pub(crate) async fn add_reaction(
    State(state): State<Arc<AppState>>,
    AxumPath((raw_channel, raw_message)): AxumPath<(String, String)>,
    AuthMember(member): AuthMember,
    JsonBody(payload): JsonBody<ReactionCreate>,
) -> ApiResult<Json<MessageRead>> {
    if payload.emoji.is_empty() || payload.emoji.len() > 64 {
        return Err(ApiError::request_validation(
            json!([{"loc":["body","emoji"]}]),
        ));
    }
    let channel_id = path_uuid(&raw_channel)?;
    let channel = reachable_channel(&state, member.server_id, channel_id).await?;
    let message = load_message(&state.pool, path_uuid(&raw_message)?).await?;
    if message.channel_id != channel_id {
        return Err(
            ApiError::not_found("That message does not exist in this channel.")
                .with("code", "message_not_found")
                .with("message_id", message.id.to_string()),
        );
    }
    if message.deleted_at.is_some() {
        return Err(ApiError::conflict("Deleted messages cannot be reacted to.")
            .with("code", "message_deleted")
            .with("message_id", message.id.to_string()));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO reactions (id, message_id, member_id, emoji, created_at, updated_at) \
         SELECT $1, $2, $3, $4, now(), now() \
         WHERE NOT EXISTS (SELECT 1 FROM reactions WHERE message_id = $2 AND member_id = $3 AND emoji = $4)",
    )
    .bind(new_id())
    .bind(message.id)
    .bind(member.id)
    .bind(&payload.emoji)
    .execute(&mut *tx)
    .await?;
    let row = load_message(&state.pool, message.id).await?;
    let read = build_read(&state.pool, &row).await?;
    queue_event(
        &mut tx,
        "reaction.added",
        channel.server_id,
        Some(channel.id),
        serde_json::to_value(&read).unwrap_or(json!({})),
    )
    .await?;
    state.finish(tx).await?;
    Ok(Json(read))
}

pub(crate) async fn remove_reaction(
    State(state): State<Arc<AppState>>,
    AxumPath((raw_channel, raw_message, emoji)): AxumPath<(String, String, String)>,
    AuthMember(member): AuthMember,
) -> ApiResult<Response> {
    let channel_id = path_uuid(&raw_channel)?;
    let channel = reachable_channel(&state, member.server_id, channel_id).await?;
    let message = load_message(&state.pool, path_uuid(&raw_message)?).await?;
    if message.channel_id != channel_id {
        return Err(
            ApiError::not_found("That message does not exist in this channel.")
                .with("code", "message_not_found")
                .with("message_id", message.id.to_string()),
        );
    }
    let result = sqlx::query(
        "DELETE FROM reactions WHERE message_id = $1 AND member_id = $2 AND emoji = $3",
    )
    .bind(message.id)
    .bind(member.id)
    .bind(&emoji)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() > 0 {
        let mut tx = state.pool.begin().await?;
        let row = load_message(&state.pool, message.id).await?;
        let read = build_read(&state.pool, &row).await?;
        queue_event(
            &mut tx,
            "reaction.removed",
            channel.server_id,
            Some(channel.id),
            serde_json::to_value(&read).unwrap_or(json!({})),
        )
        .await?;
        state.finish(tx).await?;
    }
    Ok(no_content())
}

// ─── Adjuntos ────────────────────────────────────────────────────────────────
