use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn list_channels(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
    AuthMember(member): AuthMember,
) -> ApiResult<Json<Vec<ChannelRead>>> {
    let server_id = path_uuid(&raw_id)?;
    require_same_server(member.server_id, server_id)?;
    Ok(Json(load_channels(&state.pool, server_id).await?))
}

pub(crate) async fn get_channel(
    State(state): State<Arc<AppState>>,
    Path((raw_server, raw_channel)): Path<(String, String)>,
    AuthMember(member): AuthMember,
) -> ApiResult<Json<ChannelRead>> {
    let server_id = path_uuid(&raw_server)?;
    require_same_server(member.server_id, server_id)?;
    Ok(Json(
        load_channel(&state.pool, server_id, path_uuid(&raw_channel)?)
            .await?
            .into(),
    ))
}

pub(crate) async fn join_channel(
    State(state): State<Arc<AppState>>,
    Path((raw_server, raw_channel)): Path<(String, String)>,
    AuthMember(member): AuthMember,
) -> ApiResult<Json<ChannelRead>> {
    let server_id = path_uuid(&raw_server)?;
    require_same_server(member.server_id, server_id)?;
    let server = load_server(&state.pool, server_id).await?;
    if !server.status()?.accepts_traffic() {
        let state_name = server.status()?.as_str();
        return Err(ApiError::server_inactive(
            "Server is inactive. It accepts no connections until its owner activates it again.",
        )
        .with("server_id", server_id.to_string())
        .with("state", state_name));
    }
    Ok(Json(
        load_channel(&state.pool, server_id, path_uuid(&raw_channel)?)
            .await?
            .into(),
    ))
}
