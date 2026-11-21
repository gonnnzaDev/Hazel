use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use super::*;

#[derive(Debug, Serialize)]
pub struct MessageRead {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author: MessageAuthorRead,
    pub content: Option<String>,
    pub reply_to: Option<Uuid>,
    pub attachments: Vec<String>,
    pub reactions: Vec<ReactionRead>,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub deleted: bool,
}
