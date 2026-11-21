use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::Response;
use axum::Json;
use serde_json::json;

use crate::auth::AdminAuth;
use crate::error::{ApiError, ApiResult};
use crate::events::{queue_event, record_audit};
use crate::state::AppState;

use super::*;

pub(crate) async fn activate_server(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<ServerRead>> {
    let id = path_uuid(&raw_id)?;
    let mut tx = state.pool.begin().await?;
    let row = load_server_tx(&mut tx, id).await?;
    let status = row.status()?;
    if status == ServerStatus::Active {
        sqlx::query(
            "UPDATE servers SET last_heartbeat_at = now(), updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else {
        if status == ServerStatus::Deleted {
            return Err(
                ApiError::conflict("This server was deleted and cannot be reactivated.")
                    .with("code", "server_deleted")
                    .with("server_id", id.to_string()),
            );
        }
        if !status.can_transition(ServerStatus::Active) {
            return Err(ApiError::conflict(format!(
                "Cannot activate a server in state '{}'.",
                status.as_str()
            ))
            .with("code", "invalid_state_transition")
            .with("current", status.as_str())
            .with("target", "active"));
        }
        sqlx::query("UPDATE servers SET status = 'active'::server_status, last_heartbeat_at = now(), updated_at = now() WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        queue_event(
            &mut tx,
            "server.state_changed",
            id,
            None,
            json!({ "slug": row.slug, "status": "active" }),
        )
        .await?;
    }
    let updated = load_server_tx(&mut tx, id).await?;
    let read = server_read(&state.pool, &updated).await?;
    queue_event(
        &mut tx,
        "server.state_changed",
        id,
        None,
        json!({ "server_id": id.to_string(), "status": "active" }),
    )
    .await?;
    record_audit(
        &mut tx,
        id,
        Some("admin"),
        "server.activated",
        Some("server"),
        Some(&id.to_string()),
        json!({}),
    )
    .await?;
    state.finish(tx).await?;
    Ok(Json(read))
}

pub(crate) async fn deactivate_server(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<ServerRead>> {
    let id = path_uuid(&raw_id)?;
    let mut tx = state.pool.begin().await?;
    let row = load_server_tx(&mut tx, id).await?;
    let status = row.status()?;
    if status == ServerStatus::Deleted {
        return Err(ApiError::conflict("This server was already deleted.")
            .with("code", "server_deleted")
            .with("server_id", id.to_string()));
    }
    if status == ServerStatus::Inactive {
        let read = server_read(&state.pool, &row).await?;
        state.finish(tx).await?;
        return Ok(Json(read));
    }
    if !status.can_transition(ServerStatus::Inactive) {
        return Err(ApiError::conflict(format!(
            "Cannot deactivate a server in state '{}'.",
            status.as_str()
        ))
        .with("code", "invalid_state_transition")
        .with("current", status.as_str())
        .with("target", "inactive"));
    }
    sqlx::query(
        "UPDATE servers SET status = 'inactive'::server_status, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if let Some(supervisor) = &state.supervisor {
        supervisor.terminate(id).await;
    }
    queue_event(
        &mut tx,
        "server.state_changed",
        id,
        None,
        json!({ "slug": row.slug, "status": "inactive" }),
    )
    .await?;
    let updated = load_server_tx(&mut tx, id).await?;
    let read = server_read(&state.pool, &updated).await?;
    queue_event(
        &mut tx,
        "server.state_changed",
        id,
        None,
        json!({ "server_id": id.to_string(), "status": "inactive" }),
    )
    .await?;
    record_audit(
        &mut tx,
        id,
        Some("admin"),
        "server.deactivated",
        Some("server"),
        Some(&id.to_string()),
        json!({}),
    )
    .await?;
    state.finish(tx).await?;
    Ok(Json(read))
}

pub(crate) async fn heartbeat(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<ServerRead>> {
    let id = path_uuid(&raw_id)?;
    let mut tx = state.pool.begin().await?;
    load_server_tx(&mut tx, id).await?;
    sqlx::query("UPDATE servers SET last_heartbeat_at = now(), updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let row = load_server_tx(&mut tx, id).await?;
    let read = server_read(&state.pool, &row).await?;
    state.finish(tx).await?;
    Ok(Json(read))
}

pub(crate) async fn delete_server(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
) -> ApiResult<Response> {
    let id = path_uuid(&raw_id)?;
    let mut tx = state.pool.begin().await?;
    let row = load_server_tx(&mut tx, id).await?;
    if row.status()?.is_terminal() {
        return Err(ApiError::conflict("This server was already deleted.")
            .with("code", "server_deleted")
            .with("server_id", id.to_string()));
    }
    if let Some(supervisor) = &state.supervisor {
        supervisor.terminate(id).await;
    }
    let slug = row.slug.clone();
    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    queue_event(
        &mut tx,
        "server.state_changed",
        id,
        None,
        json!({ "slug": slug, "status": "deleted" }),
    )
    .await?;
    record_audit(
        &mut tx,
        id,
        Some("admin"),
        "server.deleted",
        Some("server"),
        Some(&id.to_string()),
        json!({}),
    )
    .await?;
    state.finish(tx).await?;
    Ok(no_content())
}
