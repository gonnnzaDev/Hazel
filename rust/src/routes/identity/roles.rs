use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde_json::json;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::events::record_audit;
use crate::state::AppState;

use super::*;

pub(crate) async fn set_member_role(
    State(state): State<Arc<AppState>>,
    Path((raw_id, nickname)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    AuthMember(actor): AuthMember,
) -> ApiResult<Json<MemberRead>> {
    let server_id = path_uuid(&raw_id)?;
    let label = query.get("role").cloned().unwrap_or_default();
    let new_role = match label.as_str() {
        "member" => Role::Member,
        "admin" => Role::Admin,
        _ => {
            return Err(ApiError::validation(format!("Unknown role: '{label}'."))
                .with("code", "invalid_role")
                .with("allowed", json!(["member", "admin"])))
        }
    };
    let target = load_member_by_nickname(&state.pool, server_id, &nickname).await?;
    if actor.server_id != target.server_id {
        return Err(
            ApiError::forbidden("You cannot manage members of another server.")
                .with("code", "wrong_server"),
        );
    }
    if Role::from_i16(actor.role) != Role::Owner && Role::from_i16(actor.role) < Role::Admin {
        return Err(
            ApiError::forbidden("You must be an administrator to change roles.")
                .with("code", "not_admin"),
        );
    }
    let target_role = Role::from_i16(target.role);
    if target_role == Role::Owner || new_role == Role::Owner {
        return Err(
            ApiError::forbidden("The owner role cannot be changed via API.")
                .with("code", "owner_role_immutable"),
        );
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE members SET role = $2, updated_at = now() WHERE id = $1")
        .bind(target.id)
        .bind(new_role as i16)
        .execute(&mut *tx)
        .await?;
    let updated = load_member_tx(&mut tx, target.id).await?;
    record_audit(
        &mut tx,
        server_id,
        Some(&actor.nickname),
        "member.role_changed",
        Some("member"),
        Some(&target.id.to_string()),
        json!({ "role": new_role.label() }),
    )
    .await?;
    let read: MemberRead = updated.into();
    state.finish(tx).await?;
    Ok(Json(read))
}
