use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;
use axum::Json;
use serde_json::json;

use crate::auth::AuthMember;
use crate::error::ApiResult;
use crate::state::AppState;

use super::*;

pub(crate) async fn refresh(
    State(state): State<Arc<AppState>>,
    RawToken(raw): RawToken,
) -> ApiResult<Json<TokenResponse>> {
    let member = authenticate(&state.pool, &raw).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM member_tokens WHERE token_hash = $1")
        .bind(hash_token(&raw))
        .execute(&mut *tx)
        .await?;
    let token = issue_token(&mut tx, member.id, member.server_id).await?;
    state.finish(tx).await?;
    Ok(Json(token))
}

pub(crate) async fn logout(
    State(state): State<Arc<AppState>>,
    RawToken(raw): RawToken,
) -> ApiResult<Response> {
    authenticate(&state.pool, &raw).await?;
    sqlx::query("DELETE FROM member_tokens WHERE token_hash = $1")
        .bind(hash_token(&raw))
        .execute(&state.pool)
        .await?;
    Ok(no_content())
}

pub(crate) async fn logout_all(
    State(state): State<Arc<AppState>>,
    RawToken(raw): RawToken,
) -> ApiResult<Json<serde_json::Value>> {
    let member = authenticate(&state.pool, &raw).await?;
    let mut tx = state.pool.begin().await?;
    let result = sqlx::query(
        "UPDATE member_tokens SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL",
    )
    .bind(member.id)
    .execute(&mut *tx)
    .await?;
    let token = issue_token(&mut tx, member.id, member.server_id).await?;
    state.finish(tx).await?;
    Ok(Json(json!({
        "token": token.token,
        "expires_at": token.expires_at,
        "revoked_sessions": result.rows_affected(),
    })))
}

pub(crate) async fn me(
    State(state): State<Arc<AppState>>,
    AuthMember(member): AuthMember,
) -> ApiResult<Json<MeResponse>> {
    let server = load_server(&state.pool, member.server_id).await?;
    Ok(Json(MeResponse {
        member: member.into(),
        server: server_summary(&server),
    }))
}

pub(crate) async fn update_me(
    State(state): State<Arc<AppState>>,
    AuthMember(member): AuthMember,
    JsonBody(payload): JsonBody<MeUpdate>,
) -> ApiResult<Json<MemberRead>> {
    let cleaned = clean_display_name(Some(payload.name), "")?;
    sqlx::query("UPDATE members SET display_name = $2, updated_at = now() WHERE id = $1")
        .bind(member.id)
        .bind(&cleaned)
        .execute(&state.pool)
        .await?;
    let mut read: MemberRead = member.into();
    read.display_name = cleaned;
    Ok(Json(read))
}
