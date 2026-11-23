use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::Response;

use crate::auth::{AuthMember, HostAdmin};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn delete_channel(
    State(state): State<Arc<AppState>>,
    Path((raw_server, raw_channel)): Path<(String, String)>,
    AuthMember(member): AuthMember,
    _host: HostAdmin,
) -> ApiResult<Response> {
    let server_id = path_uuid(&raw_server)?;
    require_same_server(member.server_id, server_id)?;
    let channel = load_channel(&state.pool, server_id, path_uuid(&raw_channel)?).await?;
    if channel.is_default {
        return Err(ApiError::conflict("The default channel cannot be deleted.")
            .with("code", "default_channel"));
    }
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel.id)
        .execute(&state.pool)
        .await?;
    Ok(no_content())
}
