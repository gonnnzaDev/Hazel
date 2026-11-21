use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ReadyResponse {
    pub status: String,
    pub checks: serde_json::Value,
}
