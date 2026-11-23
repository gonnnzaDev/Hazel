//! Autorización para gestionar servidores.
//!
//! La única credencial de gestión es la máquina anfitriona del nodo: las
//! peticiones de otros equipos son rechazadas con `host_required`, tengan o no
//! un token de miembro. Los tokens de miembro siguen sirviendo para chatear.

use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use uuid::Uuid;

use super::*;
use crate::error::ApiResult;
use crate::state::AppState;

#[derive(Debug, Clone, Copy)]
pub enum ServerAuth {
    Host,
}

impl ServerAuth {
    /// La autoridad del host alcanza cualquier servidor del nodo.
    pub fn check(&self, _server_id: Uuid) -> ApiResult<()> {
        Ok(())
    }
}

impl FromRequestParts<Arc<AppState>> for ServerAuth {
    type Rejection = crate::error::ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> ApiResult<Self> {
        HostAdmin::from_request_parts(parts, state).await?;
        Ok(Self::Host)
    }
}
