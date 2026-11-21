use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct BackupRead {
    pub backup_id: String,
    pub path: String,
    pub size: u64,
    pub created_at: DateTime<Utc>,
}
