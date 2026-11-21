use serde::Serialize;
use uuid::Uuid;

use super::*;

#[derive(Debug, Serialize)]
pub struct ChannelRead {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub kind: ChannelKind,
    pub topic: Option<String>,
    pub position: i32,
    pub is_default: bool,
}
