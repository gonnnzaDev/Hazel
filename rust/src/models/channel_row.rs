use sqlx::FromRow;
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, FromRow)]
pub struct ChannelRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub kind: String,
    pub topic: Option<String>,
    pub position: i32,
    pub is_default: bool,
}

impl From<ChannelRow> for ChannelRead {
    fn from(row: ChannelRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            name: row.name,
            kind: row.kind.parse().unwrap_or(ChannelKind::Text),
            topic: row.topic,
            position: row.position,
            is_default: row.is_default,
        }
    }
}
