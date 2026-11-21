use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MemberRead {
    pub id: String,
    pub nickname: String,
    pub display_name: String,
    pub role: &'static str,
    pub is_online: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub joined_at: DateTime<Utc>,
}
