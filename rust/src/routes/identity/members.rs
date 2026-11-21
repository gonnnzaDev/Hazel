use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::Json;
use serde_json::json;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::events::{queue_event, record_audit};
use crate::state::AppState;

use super::*;

pub(crate) async fn list_members(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult<Json<MemberListResponse>> {
    let server_id = path_uuid(&raw_id)?;
    load_server(&state.pool, server_id).await?;
    let limit = query_i64(&query, "limit", 50, 1, Some(200))?;
    let offset = query_i64(&query, "offset", 0, 0, None)?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM members WHERE server_id = $1")
        .bind(server_id)
        .fetch_one(&state.pool)
        .await?;
    let sql = format!("SELECT {MEMBER_COLUMNS} FROM members WHERE server_id = $1 ORDER BY nickname LIMIT $2 OFFSET $3");
    let rows = sqlx::query_as::<_, MemberRow>(&sql)
        .bind(server_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(MemberListResponse {
        items: rows.into_iter().map(Into::into).collect(),
        total,
        limit,
        offset,
    }))
}

pub(crate) async fn get_member(
    State(state): State<Arc<AppState>>,
    Path((raw_id, nickname)): Path<(String, String)>,
) -> ApiResult<Json<MemberRead>> {
    let server_id = path_uuid(&raw_id)?;
    if nickname.len() < 2 || nickname.len() > 32 {
        return Err(ApiError::request_validation(
            json!([{"loc":["path","nickname"]}]),
        ));
    }
    load_server(&state.pool, server_id).await?;
    Ok(Json(
        load_member_by_nickname(&state.pool, server_id, &nickname)
            .await?
            .into(),
    ))
}

pub(crate) async fn kick_member(
    State(state): State<Arc<AppState>>,
    Path((raw_id, nickname)): Path<(String, String)>,
    AuthMember(actor): AuthMember,
) -> ApiResult<Response> {
    let server_id = path_uuid(&raw_id)?;
    let target = load_member_by_nickname(&state.pool, server_id, &nickname).await?;
    if actor.server_id != target.server_id {
        return Err(
            ApiError::forbidden("You cannot manage members of another server.")
                .with("code", "wrong_server"),
        );
    }
    let actor_role = Role::from_i16(actor.role);
    let target_role = Role::from_i16(target.role);
    if !actor_role.can_administer() {
        return Err(
            ApiError::forbidden("You must be an administrator to kick someone.")
                .with("code", "not_admin"),
        );
    }
    if actor.id == target.id {
        return Err(
            ApiError::validation("You cannot kick yourself. Use 'leave the server'.")
                .with("code", "cannot_kick_self"),
        );
    }
    if (actor.role) <= target.role {
        return Err(ApiError::forbidden(
            "You cannot kick someone with an equal or higher role than yours.",
        )
        .with("code", "role_hierarchy")
        .with("your_role", actor_role.label())
        .with("their_role", target_role.label()));
    }
    let target_data = MemberRead::from(target.clone());
    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM members WHERE id = $1")
        .bind(target.id)
        .execute(&mut *tx)
        .await?;
    if target_role == Role::Owner {
        promote_oldest(&mut tx, server_id).await?;
    }
    queue_event(
        &mut tx,
        "member.left",
        server_id,
        None,
        json!({
            "member": target_data,
            "reason": "kicked",
            "actor": { "nickname": actor.nickname, "display_name": actor.display_name },
        }),
    )
    .await?;
    record_audit(
        &mut tx,
        server_id,
        Some(&actor.nickname),
        "member.kicked",
        Some("member"),
        Some(&target.id.to_string()),
        json!({ "target": target.nickname }),
    )
    .await?;
    state.finish(tx).await?;
    Ok(no_content())
}
