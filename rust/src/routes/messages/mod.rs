//! Endpoints de mensajes, reacciones y adjuntos.

use std::sync::Arc;

use axum::routing::{delete, get, post};
use axum::Router;

use crate::models::*;
use crate::state::AppState;

pub(crate) use super::*;

use crate::utils::*;

pub(crate) const MESSAGE_COLUMNS: &str =
    "id, channel_id, author_nickname, author_member_id, content, reply_to, attachments, \
     edited_at, deleted_at, created_at";
mod attachment_read;
mod attachments;
mod create;
mod edit;
mod helpers;
mod list;
mod reactions;

pub(crate) use attachment_read::*;
pub(crate) use attachments::*;
pub(crate) use create::*;
pub(crate) use edit::*;
pub(crate) use helpers::*;
pub(crate) use list::*;
pub(crate) use reactions::*;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/channels/{channel_id}/messages",
            post(create_message).get(list_messages),
        )
        .route(
            "/channels/{channel_id}/messages/{message_id}",
            get(get_message).patch(edit_message).delete(delete_message),
        )
        .route(
            "/channels/{channel_id}/messages/{message_id}/reactions",
            post(add_reaction),
        )
        .route(
            "/channels/{channel_id}/messages/{message_id}/reactions/{emoji}",
            delete(remove_reaction),
        )
        .route(
            "/channels/{channel_id}/attachments",
            post(create_attachment),
        )
        .route(
            "/attachments/{attachment_id}",
            get(get_attachment).delete(delete_attachment),
        )
}
