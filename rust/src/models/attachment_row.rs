use sqlx::FromRow;
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, FromRow)]
pub struct AttachmentRow {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: i32,
    pub storage_key: String,
}

impl From<AttachmentRow> for AttachmentRead {
    fn from(row: AttachmentRow) -> Self {
        Self {
            id: row.id,
            message_id: row.message_id,
            filename: row.filename,
            content_type: row.content_type,
            size: row.size,
            storage_key: row.storage_key,
        }
    }
}
