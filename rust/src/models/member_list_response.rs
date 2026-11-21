use serde::Serialize;

use super::*;

#[derive(Debug, Serialize)]
pub struct MemberListResponse {
    pub items: Vec<MemberRead>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}
