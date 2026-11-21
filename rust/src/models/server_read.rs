use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use super::*;

#[derive(Debug, Serialize)]
pub struct ServerRead {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub id: Uuid,
    pub status: ServerStatus,
    pub max_members: i32,
    pub last_heartbeat_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub channels: Vec<ChannelRead>,
}
