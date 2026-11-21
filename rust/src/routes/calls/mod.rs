//! WebSocket de señalización WebRTC y participantes.

use std::sync::Arc;

use axum::routing::get;
use axum::Router;

use crate::models::*;
use crate::state::AppState;

pub(crate) use super::*;

use crate::utils::*;

mod identity;
mod participants;
mod signaling;

pub(crate) use identity::*;
pub(crate) use participants::*;
pub(crate) use signaling::*;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/servers",
        Router::new()
            .route(
                "/{server_id}/channels/{channel_id}/call",
                get(call_signaling),
            )
            .route(
                "/{server_id}/channels/{channel_id}/call/participants",
                get(call_participants),
            ),
    )
}
