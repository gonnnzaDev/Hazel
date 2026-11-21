use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, FromRow)]
pub struct AuditRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub actor_nickname: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

impl From<AuditRow> for AuditEventRead {
    fn from(row: AuditRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            actor_nickname: row.actor_nickname,
            action: row.action,
            target_type: row.target_type,
            target_id: row.target_id,
            data: row.data,
            created_at: row.created_at,
        }
    }
}
