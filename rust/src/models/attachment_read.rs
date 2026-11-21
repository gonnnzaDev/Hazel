use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct AttachmentRead {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: i32,
    pub storage_key: String,
}
