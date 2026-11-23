use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::json;

use crate::auth::{AuthMember, HostAdmin};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn create_channel(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
    AuthMember(member): AuthMember,
    _host: HostAdmin,
    JsonBody(payload): JsonBody<crate::models::ChannelCreate>,
) -> ApiResult<(StatusCode, Json<ChannelRead>)> {
    let server_id = path_uuid(&raw_id)?;
    require_same_server(member.server_id, server_id)?;
    let name = clean_name(&payload.name)?;
    if name_taken(&state.pool, server_id, &name, None).await? {
        return Err(
            ApiError::conflict(format!("Channel '{name}' already exists in this server."))
                .with("code", "channel_name_taken")
                .with("name", name),
        );
    }
    let position = match payload.position {
        Some(position) => {
            if position < 0 {
                return Err(ApiError::request_validation(
                    json!([{"loc":["body","position"]}]),
                ));
            }
            position
        }
        None => sqlx::query_scalar::<_, Option<i32>>(
            "SELECT max(position) FROM channels WHERE server_id = $1",
        )
        .bind(server_id)
        .fetch_one(&state.pool)
        .await?
        .map(|p| p + 1)
        .unwrap_or(1),
    };
    let id = new_id();
    sqlx::query(
        "INSERT INTO channels (id, server_id, name, kind, topic, position, is_default, created_at, updated_at) \
         VALUES ($1, $2, $3, $4::channel_kind, $5, $6, false, now(), now())",
    )
    .bind(id)
    .bind(server_id)
    .bind(&name)
    .bind(payload.kind.as_str())
    .bind(payload.topic.as_deref())
    .bind(position)
    .execute(&state.pool)
    .await?;
    let row = load_channel(&state.pool, server_id, id).await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}
