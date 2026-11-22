//! Autorización para gestionar servidores.
//!
//! Acepta dos credenciales:
//! - el token de administración del nodo (`HAZEL_ADMIN_TOKEN`), válido para todo;
//! - el token de miembro del **dueño** de un servidor, generado automáticamente
//!   al unirse con el apodo del dueño. Solo sirve para ese servidor.

use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use uuid::Uuid;

use super::*;
use crate::error::{ApiError, ApiResult};
use crate::models::{MemberRow, Role};
use crate::state::AppState;

pub enum ServerAuth {
    NodeAdmin,
    Owner(MemberRow),
}

impl ServerAuth {
    /// Comprueba que la credencial tiene derecho sobre este servidor.
    /// El token del nodo sirve para cualquiera; el del dueño solo para el suyo.
    pub fn check(&self, server_id: Uuid) -> ApiResult<()> {
        if let Self::Owner(member) = self {
            if member.server_id != server_id {
                return Err(ApiError::forbidden("This token belongs to another server.")
                    .with("code", "wrong_server")
                    .with("server_id", server_id.to_string()));
            }
        }
        Ok(())
    }
}

impl FromRequestParts<Arc<AppState>> for ServerAuth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> ApiResult<Self> {
        let provided = bearer_token(&parts.headers);
        let configured = state.settings.admin_token.trim();

        if provided.is_empty() {
            return Err(ApiError::unauthenticated("Missing token.").with("code", "missing_token"));
        }

        if !configured.is_empty() && provided == configured {
            return Ok(Self::NodeAdmin);
        }

        let member = authenticate(&state.pool, &provided).await?;
        if Role::from_i16(member.role) != Role::Owner {
            return Err(ApiError::forbidden("Only the server owner can do this.")
                .with("code", "owner_required"));
        }
        Ok(Self::Owner(member))
    }
}
