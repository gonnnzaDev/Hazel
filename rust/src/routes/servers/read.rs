use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde_json::json;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn list_servers(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult<Json<ServerListResponse>> {
    let limit = query_i64(&query, "limit", 20, 1, Some(100))?;
    let offset = query_i64(&query, "offset", 0, 0, None)?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM servers")
        .fetch_one(&state.pool)
        .await?;
    let sql = format!("SELECT {SERVER_COLUMNS} FROM servers ORDER BY id DESC LIMIT $1 OFFSET $2");
    let rows = sqlx::query_as::<_, ServerRow>(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;
    let mut items = vec![];
    for row in &rows {
        items.push(server_read(&state.pool, row).await?);
    }
    Ok(Json(ServerListResponse {
        items,
        total,
        limit,
        offset,
    }))
}

pub(crate) async fn get_server(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<ServerRead>> {
    let row = load_server(&state.pool, path_uuid(&raw_id)?).await?;
    Ok(Json(server_read(&state.pool, &row).await?))
}

pub(crate) async fn get_server_by_slug(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> ApiResult<Json<ServerRead>> {
    if slug.len() < 2 || slug.len() > 64 {
        return Err(ApiError::request_validation(
            json!([{"loc":["path","slug"]}]),
        ));
    }
    let row = load_server_by_slug(&state.pool, &slug).await?;
    Ok(Json(server_read(&state.pool, &row).await?))
}
