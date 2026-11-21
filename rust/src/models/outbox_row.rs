use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, FromRow)]
pub struct OutboxRow {
    pub id: Uuid,
    pub event_type: String,
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub data: serde_json::Value,
}
