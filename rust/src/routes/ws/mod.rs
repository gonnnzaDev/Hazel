//! WebSocket de eventos: presencia, suscripciones y typing.

use crate::events::*;

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::Router;

use crate::models::*;
use crate::state::AppState;

use crate::auth::*;

use crate::utils::*;
use axum::extract::ws::WebSocketUpgrade;

mod errors;
mod reader;
mod socket;

pub(crate) use errors::*;
pub(crate) use reader::*;
pub(crate) use socket::*;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/ws", get(ws_events))
}

async fn ws_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HashMap<String, String>>,
    upgrade: WebSocketUpgrade,
) -> axum::response::Response {
    upgrade.on_upgrade(move |socket| {
        run_socket(
            state,
            socket,
            query.get("token").cloned().unwrap_or_default(),
        )
    })
}
