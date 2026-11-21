//! Ensamblado del router y helpers compartidos por los handlers.

use std::sync::Arc;

use axum::extract::{FromRequest, Request};
use axum::Router;
use serde::de::DeserializeOwned;
use tower_http::cors::{Any, CorsLayer};

use crate::error::not_found_fallback;
use crate::state::AppState;

pub mod calls;
pub mod channels;
pub mod health;
pub mod identity;
pub mod messages;
pub mod node;
pub mod servers;
pub mod ws;

pub const SERVER_COLUMNS: &str =
    "id, name, slug, description, status::text AS status, bind_port, max_members, \
     last_heartbeat_at, created_at, updated_at";
pub const CHANNEL_COLUMNS: &str =
    "id, server_id, name, kind::text AS kind, topic, position, is_default";
pub const MEMBER_COLUMNS: &str =
    "id, server_id, nickname, display_name, role, is_online, last_seen_at, created_at";

pub fn app_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        .nest("/node", node::router())
        .merge(servers::router())
        .merge(identity::router())
        .merge(channels::router())
        .merge(messages::router())
        .merge(calls::router())
        .merge(ws::router());

    Router::new()
        .nest("/health", health::router())
        .nest("/api/v1", api)
        .fallback(not_found_fallback)
        .layer(cors)
        .with_state(state)
}

mod helpers;
mod json_body;

pub(crate) use helpers::*;
pub(crate) use json_body::*;
