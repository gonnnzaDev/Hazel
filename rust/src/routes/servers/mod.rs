//! Endpoints de servidores.

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;

use crate::models::*;
use crate::state::AppState;

pub(crate) use super::*;

use crate::utils::*;

mod address;
mod backup;
mod create;
mod invites;
mod lifecycle;
mod read;
mod restore;
mod update;

pub(crate) use address::*;
pub(crate) use backup::*;
pub(crate) use create::*;
pub(crate) use invites::*;
pub(crate) use lifecycle::*;
pub(crate) use read::*;
pub(crate) use restore::*;
pub(crate) use update::*;

pub fn router() -> Router<Arc<AppState>> {
    let admin = Router::new()
        .route("/", post(create_server).get(list_servers))
        .route("/by-slug/{slug}", get(get_server_by_slug))
        .route(
            "/{server_id}",
            get(get_server).patch(update_server).delete(delete_server),
        )
        .route("/{server_id}/activate", post(activate_server))
        .route("/{server_id}/deactivate", post(deactivate_server))
        .route("/{server_id}/heartbeat", post(heartbeat))
        .route("/{server_id}/address", get(get_address))
        .route("/{server_id}/stats", get(get_stats))
        .route("/{server_id}/events", get(list_events))
        .route("/{server_id}/backup", post(create_backup))
        .route("/{server_id}/restore", post(restore_backup))
        .route("/{server_id}/invites", post(create_invite));

    let invites = Router::new().route("/{code}", get(get_invite).delete(delete_invite));

    Router::new()
        .nest("/servers", admin)
        .nest("/invites", invites)
}
