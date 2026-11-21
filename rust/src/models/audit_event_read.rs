use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct AuditEventRead {
    pub id: Uuid,
    pub server_id: Uuid,
    pub actor_nickname: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
}
