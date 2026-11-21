use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) struct CallIdentity {
    pub(crate) member_id: String,
    pub(crate) nickname: String,
    pub(crate) display_name: String,
}

pub(crate) async fn resolve_identity(
    state: &AppState,
    server_id: &str,
    channel_id: &str,
    token: &str,
) -> ApiResult<CallIdentity> {
    if token.is_empty() {
        return Err(ApiError::unauthenticated("Missing token.").with("code", "missing_token"));
    }
    let (sid, cid) = match (Uuid::parse_str(server_id), Uuid::parse_str(channel_id)) {
        (Ok(sid), Ok(cid)) => (sid, cid),
        _ => {
            return Err(ApiError::not_found("Server or channel does not exist.")
                .with("code", "call_target_not_found"))
        }
    };

    let member_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT member_id FROM member_tokens WHERE token_hash = $1 AND revoked_at IS NULL \
         AND (expires_at IS NULL OR expires_at > now())",
    )
    .bind(hash_token(token))
    .fetch_optional(&state.pool)
    .await?;
    let Some(member_id) = member_id else {
        return Err(
            ApiError::unauthenticated("The token is invalid or expired.")
                .with("code", "invalid_token"),
        );
    };
    let member: (Uuid, Uuid, String, String) =
        sqlx::query_as("SELECT id, server_id, nickname, display_name FROM members WHERE id = $1")
            .bind(member_id)
            .fetch_one(&state.pool)
            .await?;
    if member.1 != sid {
        return Err(ApiError::forbidden("Your token belongs to another server.")
            .with("code", "wrong_server"));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND server_id = $2)",
    )
    .bind(cid)
    .bind(sid)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(
            ApiError::not_found("Channel does not exist on this server.")
                .with("code", "channel_not_found")
                .with("channel_id", cid.to_string()),
        );
    }
    Ok(CallIdentity {
        member_id: member.0.to_string(),
        nickname: member.2,
        display_name: member.3,
    })
}
