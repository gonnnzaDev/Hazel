use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ReactionRead {
    pub emoji: String,
    pub nickname: String,
}
