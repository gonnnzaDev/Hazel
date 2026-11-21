use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;

use crate::auth::AdminAuth;
use crate::error::ApiResult;
use crate::state::AppState;

use super::*;

pub(crate) async fn get_address(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<ServerAddress>> {
    let row = load_server(&state.pool, path_uuid(&raw_id)?).await?;
    let is_active = row.status()?.accepts_traffic();
    let candidates = local_addresses(false);
    let recommended = candidates.first().map(|a| a.host.clone());
    let node = NodeAddress {
        port: state.settings.port,
        bind_host: state.settings.host.clone(),
        is_wildcard: is_wildcard(&state.settings.host),
        recommended: recommended.clone(),
        candidates,
    };
    let address = recommended
        .as_ref()
        .map(|host| format!("{host}:{}", row.bind_port));
    Ok(Json(ServerAddress {
        server_id: row.id,
        slug: row.slug,
        server_name: row.name,
        is_active,
        host: recommended,
        port: row.bind_port,
        address,
        node,
    }))
}

pub(crate) async fn get_stats(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<ServerStats>> {
    let id = path_uuid(&raw_id)?;
    load_server(&state.pool, id).await?;
    let members: i64 = sqlx::query_scalar("SELECT count(*) FROM members WHERE server_id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    let messages: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.server_id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    let attachment_bytes: i64 = sqlx::query_scalar(
        "SELECT coalesce(sum(a.size), 0) FROM attachments a \
         JOIN messages m ON m.id = a.message_id JOIN channels c ON c.id = m.channel_id \
         WHERE c.server_id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    let db_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())::bigint")
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or(0);
    Ok(Json(ServerStats {
        server_id: id,
        members,
        messages,
        attachment_bytes,
        db_bytes,
        total_bytes: attachment_bytes + db_bytes,
    }))
}

pub(crate) async fn list_events(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult<Json<AuditEventListResponse>> {
    let id = path_uuid(&raw_id)?;
    load_server(&state.pool, id).await?;
    let limit = query_i64(&query, "limit", 50, 1, Some(100))?;
    let offset = query_i64(&query, "offset", 0, 0, None)?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE server_id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    let rows = sqlx::query_as::<_, AuditRow>(
        "SELECT id, server_id, actor_nickname, action, target_type, target_id, data, created_at \
         FROM audit_events WHERE server_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
    )
    .bind(id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AuditEventListResponse {
        items: rows.into_iter().map(Into::into).collect(),
        total,
        limit,
        offset,
    }))
}

// ─── Backup / restore ────────────────────────────────────────────────────────
