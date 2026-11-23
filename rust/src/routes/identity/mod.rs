//! Endpoints de identidad: unirse, miembros y tokens.

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;

use crate::models::*;
use crate::state::AppState;

pub(crate) use super::*;
use crate::auth::*;

use crate::utils::*;

const TOKEN_TTL_DAYS: i64 = 30;
mod helpers;
mod join;
mod leave;
mod members;
mod tokens;

pub(crate) use helpers::*;
pub(crate) use join::*;
pub(crate) use leave::*;
pub(crate) use members::*;
pub(crate) use tokens::*;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/servers/{server_id}/join", post(join))
        .route("/servers/{server_id}/leave", post(leave))
        .route("/servers/{server_id}/members", get(list_members))
        .route(
            "/servers/{server_id}/members/{nickname}",
            get(get_member).delete(kick_member),
        )
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/logout-all", post(logout_all))
        .route("/me", get(me).patch(update_me))
}
