use super::*;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use std::sync::Arc;

pub struct AdminAuth;

impl FromRequestParts<Arc<AppState>> for AdminAuth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> ApiResult<Self> {
        let configured = state.settings.admin_token.trim();
        if configured.is_empty() {
            return Err(ApiError::new(
                503,
                "admin_token_not_configured",
                "Admin token not configured",
                "HAZEL_ADMIN_TOKEN is not configured. Set it in your .env to manage servers.",
            ));
        }

        let provided = bearer_token(&parts.headers);

        if provided.is_empty() || provided != configured {
            return Err(ApiError::unauthenticated(
                "A valid node administration token is required.",
            )
            .with("code", "invalid_admin_token"));
        }
        Ok(Self)
    }
}
