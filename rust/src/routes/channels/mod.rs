//! Endpoints de canales.

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;

use crate::models::*;
use crate::state::AppState;

pub(crate) use super::*;

use crate::utils::*;

mod create;
mod delete;
mod helpers;
mod read;
mod update;

pub(crate) use create::*;
pub(crate) use delete::*;
pub(crate) use helpers::*;
pub(crate) use read::*;
pub(crate) use update::*;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/servers",
        Router::new()
            .route(
                "/{server_id}/channels",
                post(create_channel).get(list_channels),
            )
            .route(
                "/{server_id}/channels/{channel_id}",
                get(get_channel)
                    .patch(update_channel)
                    .delete(delete_channel),
            )
            .route(
                "/{server_id}/channels/{channel_id}/join",
                post(join_channel),
            ),
    )
}
