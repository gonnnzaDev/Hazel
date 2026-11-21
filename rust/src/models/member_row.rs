use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, FromRow)]
pub struct MemberRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub nickname: String,
    pub display_name: String,
    pub role: i16,
    pub is_online: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<MemberRow> for MemberRead {
    fn from(row: MemberRow) -> Self {
        Self {
            id: row.id.to_string(),
            nickname: row.nickname,
            display_name: row.display_name,
            role: Role::from_i16(row.role).label(),
            is_online: row.is_online,
            last_seen_at: row.last_seen_at,
            joined_at: row.created_at,
        }
    }
}
