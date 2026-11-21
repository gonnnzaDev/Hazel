use serde::Serialize;

use super::*;

#[derive(Debug, Serialize)]
pub struct NodeAddress {
    pub port: u16,
    pub bind_host: String,
    pub is_wildcard: bool,
    pub candidates: Vec<LocalAddress>,
    pub recommended: Option<String>,
}
