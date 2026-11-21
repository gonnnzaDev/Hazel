//! Helpers compartidos por los handlers.

pub(crate) use super::*;
mod is_wildcard;
mod load_channel;
mod load_channels;
mod load_server;
mod load_server_by_slug;
mod no_content;
mod path_uuid;
mod query;
mod server_read;

pub(crate) use is_wildcard::*;
pub(crate) use load_channel::*;
pub(crate) use load_channels::*;
pub(crate) use load_server::*;
pub(crate) use load_server_by_slug::*;
pub(crate) use no_content::*;
pub(crate) use path_uuid::*;
pub(crate) use query::*;
pub(crate) use server_read::*;
