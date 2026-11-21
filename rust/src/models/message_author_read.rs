use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MessageAuthorRead {
    pub nickname: String,
    pub display_name: Option<String>,
}
