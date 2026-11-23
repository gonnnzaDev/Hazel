use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;
use serde_json::json;

use crate::auth::AuthMember;
use crate::error::ApiResult;
use crate::events::{queue_event, record_audit};
use crate::state::AppState;

use super::*;

pub(crate) async fn leave(
    State(state): State<Arc<AppState>>,
    AuthMember(member): AuthMember,
) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    let server_id = member.server_id;
    let read = MemberRead::from(member.clone());
    sqlx::query(
        "UPDATE member_tokens SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL",
    )
    .bind(member.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM members WHERE id = $1")
        .bind(member.id)
        .execute(&mut *tx)
        .await?;
    queue_event(
        &mut tx,
        "member.left",
        server_id,
        None,
        json!({ "member": read, "reason": "left" }),
    )
    .await?;
    record_audit(
        &mut tx,
        server_id,
        Some(&member.nickname),
        "member.left",
        Some("member"),
        Some(&member.id.to_string()),
        json!({}),
    )
    .await?;
    state.finish(tx).await?;
    Ok(no_content())
}
