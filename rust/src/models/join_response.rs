use chrono::{DateTime, Utc};
use serde::Serialize;

use super::*;

#[derive(Debug, Serialize)]
pub struct JoinResponse {
    pub token: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub member: MemberRead,
    pub server: ServerSummary,
}
