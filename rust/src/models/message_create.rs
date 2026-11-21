use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct MessageCreate {
    pub content: String,
    #[serde(default)]
    pub reply_to: Option<Uuid>,
    #[serde(default)]
    pub attachments: Vec<String>,
}
