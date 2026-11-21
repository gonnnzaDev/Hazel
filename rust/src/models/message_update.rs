use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
pub struct MessageUpdate {
    pub content: Option<String>,
}
