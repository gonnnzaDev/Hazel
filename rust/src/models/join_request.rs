use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct JoinRequest {
    pub nickname: String,
    pub display_name: Option<String>,
}
