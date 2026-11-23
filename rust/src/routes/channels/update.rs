use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::json;

use crate::auth::{AuthMember, HostAdmin};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn update_channel(
    State(state): State<Arc<AppState>>,
    Path((raw_server, raw_channel)): Path<(String, String)>,
    AuthMember(member): AuthMember,
    _host: HostAdmin,
    JsonBody(payload): JsonBody<crate::models::ChannelUpdate>,
) -> ApiResult<Json<ChannelRead>> {
    let server_id = path_uuid(&raw_server)?;
    require_same_server(member.server_id, server_id)?;
    let channel_id = path_uuid(&raw_channel)?;
    let channel = load_channel(&state.pool, server_id, channel_id).await?;
    let name = match &payload.name {
        Some(raw) => Some(clean_name(raw)?),
        None => None,
    };
    if let Some(name) = &name {
        if name_taken(&state.pool, server_id, name, Some(channel_id)).await? {
            return Err(ApiError::conflict(format!(
                "Channel '{name}' already exists in this server."
            ))
            .with("code", "channel_name_taken")
            .with("name", name.clone()));
        }
    }
    if let Some(topic) = &payload.topic {
        if topic.len() > 255 {
            return Err(ApiError::request_validation(
                json!([{"loc":["body","topic"]}]),
            ));
        }
    }
    if let Some(position) = payload.position {
        if position < 0 {
            return Err(ApiError::request_validation(
                json!([{"loc":["body","position"]}]),
            ));
        }
    }
    sqlx::query(
        "UPDATE channels SET name = $2, topic = $3, position = $4, updated_at = now() WHERE id = $1",
    )
    .bind(channel_id)
    .bind(name.as_deref().unwrap_or(&channel.name))
    .bind(match &payload.topic { Some(v) => Some(v.as_str()), None => channel.topic.as_deref() })
    .bind(payload.position.unwrap_or(channel.position))
    .execute(&state.pool)
    .await?;
    let updated = load_channel(&state.pool, server_id, channel_id).await?;
    Ok(Json(updated.into()))
}
