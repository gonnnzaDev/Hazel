use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::json;

use crate::auth::AdminAuth;
use crate::error::{ApiError, ApiResult};
use crate::events::queue_event;
use crate::state::AppState;

use super::*;

pub(crate) fn validate_server_create(payload: &ServerCreate) -> ApiResult<(String, String)> {
    let name = payload.name.trim();
    if name.len() < 2 || name.len() > 64 {
        return Err(ApiError::request_validation(json!([{
            "type": "string_length", "loc": ["body", "name"]
        }])));
    }
    if payload
        .description
        .as_ref()
        .map(|d| d.len() > 1000)
        .unwrap_or(false)
    {
        return Err(ApiError::request_validation(json!([{
            "type": "string_too_long", "loc": ["body", "description"]
        }])));
    }
    if !(1..=10_000).contains(&payload.max_members) {
        return Err(ApiError::request_validation(json!([{
            "type": "greater_than_equal", "loc": ["body", "max_members"]
        }])));
    }
    let slug = normalize_slug(&payload.slug);
    if slug.is_empty() || !(2..=64).contains(&slug.len()) {
        return Err(
            ApiError::validation("Server identifier must be between 2 and 64 characters.")
                .with("code", "invalid_slug")
                .with("slug", payload.slug.clone()),
        );
    }
    let nickname = validate_nickname(&payload.owner_nickname)?;
    Ok((slug, nickname))
}

// ─── Handlers ────────────────────────────────────────────────────────────────

pub(crate) async fn create_server(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    JsonBody(payload): JsonBody<ServerCreate>,
) -> ApiResult<(StatusCode, Json<ServerRead>)> {
    let (slug, _owner) = validate_server_create(&payload)?;

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE slug = $1)")
        .bind(&slug)
        .fetch_one(&state.pool)
        .await?;
    if exists {
        return Err(
            ApiError::conflict(format!("Identifier '{slug}' is already in use."))
                .with("code", "slug_taken")
                .with("slug", slug),
        );
    }

    let Some(supervisor) = &state.supervisor else {
        return Err(ApiError::conflict(
            "This process is not the node, so it cannot manage groups. \
             Groups are managed from the node process.",
        )
        .with("code", "not_the_node"));
    };

    let mut taken: Vec<i32> = sqlx::query_scalar("SELECT bind_port FROM servers")
        .fetch_all(&state.pool)
        .await?;
    taken.extend(supervisor.used_ports().await);
    let first = state.settings.port.saturating_add(1);
    let last = state.settings.group_port_end;
    let Some(port) = next_available_port(first, last, &state.settings.host, None, &taken) else {
        return Err(ApiError::conflict(
            "No free ports left for another group. Raise HAZEL_GROUP_PORT_END in the .env if you need more.",
        )
        .with("code", "no_free_port"));
    };

    let id = new_id();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO servers (id, name, slug, description, status, bind_port, max_members, \
             created_at, updated_at) VALUES ($1, $2, $3, $4, 'creating'::server_status, $5, $6, now(), now())",
    )
    .bind(id)
    .bind(payload.name.trim())
    .bind(&slug)
    .bind(payload.description.as_deref())
    .bind(port as i32)
    .bind(payload.max_members)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO channels (id, server_id, name, kind, topic, position, is_default, created_at, updated_at) \
             VALUES ($1, $2, 'general', 'text'::channel_kind, NULL, 0, true, now(), now())",
    )
    .bind(new_id())
    .bind(id)
    .execute(&mut *tx)
    .await?;
    state.finish(tx).await?;

    supervisor.spawn(id, port).await;
    let ready = supervisor.wait_ready(id, Duration::from_secs(20)).await;

    let mut tx = state.pool.begin().await?;
    if ready {
        sqlx::query(
            "UPDATE servers SET status = 'active'::server_status, last_heartbeat_at = now(), updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE servers SET status = 'inactive'::server_status, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    let status = if ready { "active" } else { "inactive" };
    queue_event(
        &mut tx,
        "server.state_changed",
        id,
        None,
        json!({ "server_id": id.to_string(), "status": status }),
    )
    .await?;
    state.finish(tx).await?;

    let row = load_server(&state.pool, id).await?;
    Ok((
        StatusCode::CREATED,
        Json(server_read(&state.pool, &row).await?),
    ))
}
