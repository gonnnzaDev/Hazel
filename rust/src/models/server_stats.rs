use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct ServerStats {
    pub server_id: Uuid,
    pub members: i64,
    pub messages: i64,
    pub attachment_bytes: i64,
    pub db_bytes: i64,
    pub total_bytes: i64,
}
