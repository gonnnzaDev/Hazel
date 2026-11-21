use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::json;

use crate::error::{ApiError, ApiResult};
use crate::events::{queue_event, record_audit};
use crate::state::AppState;

use super::*;

pub(crate) async fn join(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
    JsonBody(payload): JsonBody<JoinRequest>,
) -> ApiResult<(StatusCode, Json<JoinResponse>)> {
    let server_id = path_uuid(&raw_id)?;
    let server = load_server(&state.pool, server_id).await?;
    if !server.status()?.accepts_traffic() {
        let status = server.status()?.as_str();
        return Err(ApiError::server_inactive(format!(
            "Server is {status}. It accepts no connections until its owner reactivates it."
        ))
        .with("server_id", server_id.to_string())
        .with("state", status));
    }

    let nickname = validate_nickname(&payload.nickname)?;
    let display_name = clean_display_name(payload.display_name, &capitalize(&nickname))?;

    let mut tx = state.pool.begin().await?;
    let existing: Option<MemberRow> = {
        let sql =
            format!("SELECT {MEMBER_COLUMNS} FROM members WHERE server_id = $1 AND nickname = $2");
        sqlx::query_as::<_, MemberRow>(&sql)
            .bind(server_id)
            .bind(&nickname)
            .fetch_optional(&mut *tx)
            .await?
    };
    let member = if let Some(member) = existing {
        member
    } else {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM members WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&mut *tx)
            .await?;
        let role = if count == 0 { 100 } else { 10 };
        let id = new_id();
        sqlx::query(
            "INSERT INTO members (id, server_id, nickname, display_name, role, is_online, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, false, now(), now())",
        )
        .bind(id)
        .bind(server_id)
        .bind(&nickname)
        .bind(&display_name)
        .bind(role)
        .execute(&mut *tx)
        .await?;
        load_member_tx(&mut tx, id).await?
    };

    let token = issue_token(&mut tx, member.id, server_id).await?;
    let read = MemberRead::from(member.clone());
    queue_event(
        &mut tx,
        "member.joined",
        server_id,
        None,
        json!({
            "member_id": member.id.to_string(),
            "nickname": member.nickname,
            "display_name": member.display_name,
            "role": Role::from_i16(member.role).label(),
        }),
    )
    .await?;
    queue_event(
        &mut tx,
        "member.joined",
        server_id,
        None,
        json!({ "member": serde_json::to_value(&read).unwrap_or(json!({})) }),
    )
    .await?;
    record_audit(
        &mut tx,
        server_id,
        Some(&member.nickname),
        "member.joined",
        Some("member"),
        Some(&member.id.to_string()),
        json!({}),
    )
    .await?;
    state.finish(tx).await?;

    Ok((
        StatusCode::CREATED,
        Json(JoinResponse {
            token: token.token,
            expires_at: token.expires_at,
            member: read,
            server: server_summary(&server),
        }),
    ))
}

pub(crate) fn capitalize(raw: &str) -> String {
    let mut chars = raw.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}
