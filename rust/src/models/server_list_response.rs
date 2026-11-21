use serde::Serialize;

use super::*;

#[derive(Debug, Serialize)]
pub struct ServerListResponse {
    pub items: Vec<ServerRead>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}
