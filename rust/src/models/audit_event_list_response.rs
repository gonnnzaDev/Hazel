use serde::Serialize;

use super::*;

#[derive(Debug, Serialize)]
pub struct AuditEventListResponse {
    pub items: Vec<AuditEventRead>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}
