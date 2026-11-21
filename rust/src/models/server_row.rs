use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::ApiResult;

use super::*;

#[derive(Debug, Clone, FromRow)]
pub struct ServerRow {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub status: String,
    pub bind_port: i32,
    pub max_members: i32,
    pub last_heartbeat_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ServerRow {
    pub fn status(&self) -> ApiResult<ServerStatus> {
        ServerStatus::from_str(&self.status)
    }
}
