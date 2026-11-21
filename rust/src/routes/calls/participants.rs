use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;

use crate::auth::AuthMember;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn call_participants(
    State(state): State<Arc<AppState>>,
    Path((raw_server, channel_id)): Path<(String, String)>,
    AuthMember(member): AuthMember,
) -> ApiResult<Json<CallParticipantsResponse>> {
    let server_id = path_uuid(&raw_server)?;
    if member.server_id != server_id {
        return Err(ApiError::forbidden("Your token belongs to another server.")
            .with("code", "wrong_server"));
    }
    let count = state.calls.count(&channel_id).await;
    Ok(Json(CallParticipantsResponse {
        participants: state
            .calls
            .snapshot(&channel_id)
            .await
            .into_iter()
            .map(|value| {
                serde_json::from_value(value).unwrap_or(crate::models::CallParticipant {
                    member_id: String::new(),
                    nickname: String::new(),
                    display_name: String::new(),
                    mic: true,
                    cam: false,
                })
            })
            .collect(),
        channel_id,
        count,
        max: state.settings.call_max_participants,
    }))
}
