use super::*;
use crate::error::{ApiError, ApiResult};
use crate::models::MemberRow;
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use std::sync::Arc;

pub struct AuthMember(pub MemberRow);

impl FromRequestParts<Arc<AppState>> for AuthMember {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> ApiResult<Self> {
        let raw = bearer_token(&parts.headers);
        let member = authenticate(&state.pool, &raw).await?;
        Ok(Self(member))
    }
}
