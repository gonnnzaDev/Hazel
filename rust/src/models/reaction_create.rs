use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ReactionCreate {
    pub emoji: String,
}
