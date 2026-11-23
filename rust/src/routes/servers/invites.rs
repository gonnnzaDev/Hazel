use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use serde_json::json;
use sqlx::Transaction;
use uuid::Uuid;

use crate::auth::{AuthMember, HostAdmin};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn create_invite(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
    AuthMember(member): AuthMember,
    _host: HostAdmin,
    JsonBody(payload): JsonBody<InviteCreate>,
) -> ApiResult<(StatusCode, Json<InviteRead>)> {
    let id = path_uuid(&raw_id)?;
    let _server = load_server(&state.pool, id).await?;
    if member.server_id != id {
        return Err(ApiError::forbidden("You don't have access to this server.")
            .with("code", "wrong_server")
            .with("server_id", id.to_string()));
    }
    if !(60..=2_592_000).contains(&payload.ttl_seconds) {
        return Err(ApiError::request_validation(
            json!([{"loc":["body","ttl_seconds"]}]),
        ));
    }
    let now = utcnow();
    let expires = now + chrono::Duration::seconds(payload.ttl_seconds);
    let code = Uuid::new_v4().simple().to_string()[..8].to_uppercase();
    let invite_id = new_id();
    sqlx::query(
        "INSERT INTO invites (id, code, server_id, created_by, created_at, expires_at, single_use, consumed, password_hash) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, NULL)",
    )
    .bind(invite_id)
    .bind(&code)
    .bind(id)
    .bind(&member.nickname)
    .bind(now)
    .bind(expires)
    .bind(payload.single_use)
    .execute(&state.pool)
    .await?;
    let row = load_invite(&state.pool, &code).await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

pub(crate) async fn get_invite(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> ApiResult<Json<InviteRead>> {
    if code.len() < 4 || code.len() > 32 {
        return Err(ApiError::request_validation(
            json!([{"loc":["path","code"]}]),
        ));
    }
    let row = load_invite(&state.pool, &code).await?;
    if row.expires_at < utcnow() {
        return Err(
            ApiError::new(410, "invite_expired", "Invite expired", "Invite expired.")
                .with("invite_code", row.code.clone()),
        );
    }
    if row.single_use && row.consumed {
        return Err(ApiError::conflict("Invite already used.")
            .with("code", "invite_invalid")
            .with("invite_code", row.code.clone()));
    }
    if row.single_use && !row.consumed {
        sqlx::query("UPDATE invites SET consumed = true WHERE id = $1")
            .bind(row.id)
            .execute(&state.pool)
            .await?;
    }
    Ok(Json(row.into()))
}

pub(crate) async fn delete_invite(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
    _host: HostAdmin,
) -> ApiResult<Response> {
    let result = sqlx::query("DELETE FROM invites WHERE code = $1")
        .bind(&code)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Invite not found.")
            .with("code", "invite_not_found")
            .with("invite_code", code));
    }
    Ok(no_content())
}

// ─── Helpers internos ────────────────────────────────────────────────────────

pub(crate) async fn load_server_tx(
    tx: &mut Transaction<'_, sqlx::Postgres>,
    id: Uuid,
) -> ApiResult<ServerRow> {
    let sql = format!("SELECT {SERVER_COLUMNS} FROM servers WHERE id = $1");
    let row = sqlx::query_as::<_, ServerRow>(&sql)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found("The server does not exist.")
            .with("code", "server_not_found")
            .with("server_id", id.to_string())
    })
}

pub(crate) async fn load_invite(pool: &sqlx::PgPool, code: &str) -> ApiResult<InviteRow> {
    let row = sqlx::query_as::<_, InviteRow>(
        "SELECT id, code, server_id, created_by, created_at, expires_at, single_use, consumed, password_hash \
         FROM invites WHERE code = $1",
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;
    row.ok_or_else(|| {
        ApiError::new(
            404,
            "invite_not_found",
            "Invite not found",
            "Invite not found.",
        )
        .with("invite_code", code.to_string())
    })
}
