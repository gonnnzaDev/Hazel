use serde::Serialize;
use uuid::Uuid;

use super::*;

#[derive(Debug, Serialize)]
pub struct ServerAddress {
    pub server_id: Uuid,
    pub slug: String,
    pub server_name: String,
    pub is_active: bool,
    pub host: Option<String>,
    pub port: i32,
    pub address: Option<String>,
    pub node: NodeAddress,
}
