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

pub(crate) async fn edit_message(
    State(state): State<Arc<AppState>>,
    AxumPath((raw_channel, raw_message)): AxumPath<(String, String)>,
    AuthMember(member): AuthMember,
    JsonBody(payload): JsonBody<MessageUpdate>,
) -> ApiResult<Json<MessageRead>> {
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
        return Err(ApiError::conflict("Deleted messages cannot be edited.")
            .with("code", "message_deleted")
            .with("message_id", message.id.to_string()));
    }
    let Some(content) = payload.content else {
        return Err(
            ApiError::validation("Provide content to edit.").with("code", "validation_error")
        );
    };
    if !can_touch(&member, &message) {
        return Err(ApiError::forbidden("Only the author can edit a message.")
            .with("code", "not_message_author"));
    }
    enforce_size(&content, state.settings.max_message_bytes)?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE messages SET content = $2, edited_at = now() WHERE id = $1")
        .bind(message.id)
        .bind(&content)
        .execute(&mut *tx)
        .await?;
    let row = load_message(&state.pool, message.id).await?;
    let read = build_read(&state.pool, &row).await?;
    queue_event(
        &mut tx,
        "message.updated",
        channel.server_id,
        Some(channel.id),
        serde_json::to_value(&read).unwrap_or(json!({})),
    )
    .await?;
    state.finish(tx).await?;
    Ok(Json(read))
}

pub(crate) async fn delete_message(
    State(state): State<Arc<AppState>>,
    AxumPath((raw_channel, raw_message)): AxumPath<(String, String)>,
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
    if message.deleted_at.is_some() {
        return Err(ApiError::conflict("The message is already deleted.")
            .with("code", "message_deleted")
            .with("message_id", message.id.to_string()));
    }
    if !can_touch(&member, &message) {
        return Err(ApiError::forbidden("Only the author can delete a message.")
            .with("code", "not_message_author"));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE messages SET deleted_at = now() WHERE id = $1")
        .bind(message.id)
        .execute(&mut *tx)
        .await?;
    queue_event(
        &mut tx,
        "message.deleted",
        channel.server_id,
        Some(channel.id),
        json!({ "message_id": message.id.to_string(), "deleted": true }),
    )
    .await?;
    state.finish(tx).await?;
    Ok(no_content())
}
