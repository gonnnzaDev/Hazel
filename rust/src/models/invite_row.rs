use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, FromRow)]
pub struct InviteRow {
    pub id: Uuid,
    pub code: String,
    pub server_id: Uuid,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub single_use: bool,
    pub consumed: bool,
    pub password_hash: Option<String>,
}

impl From<InviteRow> for InviteRead {
    fn from(row: InviteRow) -> Self {
        Self {
            code: row.code,
            server_id: row.server_id,
            created_by: row.created_by,
            created_at: row.created_at,
            expires_at: row.expires_at,
            single_use: row.single_use,
            consumed: row.consumed,
            has_password: row.password_hash.is_some(),
        }
    }
}
