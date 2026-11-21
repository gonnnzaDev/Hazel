use serde::Serialize;
use uuid::Uuid;

use super::*;

#[derive(Debug, Serialize)]
pub struct MessageListResponse {
    pub items: Vec<MessageRead>,
    pub limit: i64,
    pub next_cursor: Option<Uuid>,
}
