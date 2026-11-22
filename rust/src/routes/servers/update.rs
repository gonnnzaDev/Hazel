use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::json;

use crate::auth::ServerAuth;
use crate::error::{ApiError, ApiResult};
use crate::events::{queue_event, record_audit};
use crate::state::AppState;

use super::*;

pub(crate) async fn update_server(
    State(state): State<Arc<AppState>>,
    auth: ServerAuth,
    Path(raw_id): Path<String>,
    JsonBody(payload): JsonBody<ServerUpdate>,
) -> ApiResult<Json<ServerRead>> {
    let id = path_uuid(&raw_id)?;
    auth.check(id)?;
    if let Some(name) = &payload.name {
        if name.len() < 2 || name.len() > 64 {
            return Err(ApiError::request_validation(
                json!([{"loc":["body","name"]}]),
            ));
        }
    }
    if let Some(max) = payload.max_members {
        if !(1..=10_000).contains(&max) {
            return Err(ApiError::request_validation(
                json!([{"loc":["body","max_members"]}]),
            ));
        }
    }
    let mut tx = state.pool.begin().await?;
    let row = load_server_tx(&mut tx, id).await?;
    let name = payload.name.as_deref().unwrap_or(&row.name);
    let description = match &payload.description {
        Some(value) => Some(value.clone()),
        None => row.description.clone(),
    };
    let max_members = payload.max_members.unwrap_or(row.max_members);
    sqlx::query("UPDATE servers SET name = $2, description = $3, max_members = $4, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(max_members)
        .execute(&mut *tx)
        .await?;
    let updated = load_server_tx(&mut tx, id).await?;
    let read = server_read(&state.pool, &updated).await?;
    queue_event(
        &mut tx,
        "server.updated",
        id,
        None,
        serde_json::to_value(&read).unwrap_or(json!({})),
    )
    .await?;
    record_audit(
        &mut tx,
        id,
        Some("admin"),
        "server.updated",
        Some("server"),
        Some(&id.to_string()),
        json!({}),
    )
    .await?;
    state.finish(tx).await?;
    Ok(Json(read))
}
