use super::*;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use std::sync::Arc;

pub struct RawToken(pub String);

impl FromRequestParts<Arc<AppState>> for RawToken {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &Arc<AppState>) -> ApiResult<Self> {
        Ok(Self(bearer_token(&parts.headers)))
    }
}
