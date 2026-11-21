use axum::extract::Path as AxumPath;

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use uuid::Uuid;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn list_messages(
    State(state): State<Arc<AppState>>,
    AxumPath(raw_channel): AxumPath<String>,
    AuthMember(member): AuthMember,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<MessageListResponse>> {
    let channel_id = path_uuid(&raw_channel)?;
    reachable_channel(&state, member.server_id, channel_id).await?;
    let limit = query_i64(&query, "limit", 50, 1, Some(100))?;
    let before = query
        .get("before")
        .and_then(|value| Uuid::parse_str(value).ok());
    let sql = format!("SELECT {MESSAGE_COLUMNS} FROM messages WHERE channel_id = $1");
    let rows: Vec<MessageRow> = match before {
        Some(before) => {
            let sql = format!("{sql} AND id < $2 ORDER BY id DESC LIMIT $3");
            sqlx::query_as(&sql)
                .bind(channel_id)
                .bind(before)
                .bind(limit)
                .fetch_all(&state.pool)
                .await?
        }
        None => {
            let sql = format!("{sql} ORDER BY id DESC LIMIT $2");
            sqlx::query_as(&sql)
                .bind(channel_id)
                .bind(limit)
                .fetch_all(&state.pool)
                .await?
        }
    };
    let next_cursor = if rows.len() as i64 == limit {
        rows.last().map(|m| m.id)
    } else {
        None
    };
    let mut items = vec![];
    for row in &rows {
        items.push(build_read(&state.pool, row).await?);
    }
    Ok(Json(MessageListResponse {
        items,
        limit,
        next_cursor,
    }))
}

pub(crate) async fn get_message(
    State(state): State<Arc<AppState>>,
    AxumPath((raw_channel, raw_message)): AxumPath<(String, String)>,
    AuthMember(member): AuthMember,
) -> ApiResult<Json<MessageRead>> {
    let channel_id = path_uuid(&raw_channel)?;
    reachable_channel(&state, member.server_id, channel_id).await?;
    let message = load_message(&state.pool, path_uuid(&raw_message)?).await?;
    if message.channel_id != channel_id {
        return Err(
            ApiError::not_found("That message does not exist in this channel.")
                .with("code", "message_not_found")
                .with("message_id", message.id.to_string()),
        );
    }
    Ok(Json(build_read(&state.pool, &message).await?))
}
