//! Autorización de gestión: solo la máquina anfitriona del nodo.
//!
//! No hay roles de administrador dentro de un servidor. La autoridad para
//! gestionar servidores depende de que la petición llegue desde el propio
//! equipo que corre el nodo (loopback, una IP local o el gateway de Docker).

use std::sync::Arc;

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;
use std::net::SocketAddr;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Extractor que exige que la petición provenga de la máquina anfitriona.
pub struct HostAdmin;

impl FromRequestParts<Arc<AppState>> for HostAdmin {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> ApiResult<Self> {
        let remote = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|info| info.0.ip());

        match remote {
            Some(ip) if state.is_host(ip) => Ok(Self),
            _ => Err(
                ApiError::forbidden("Only the host machine can manage the server.")
                    .with("code", "host_required"),
            ),
        }
    }
}
