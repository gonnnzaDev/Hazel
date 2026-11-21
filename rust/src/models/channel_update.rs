use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
pub struct ChannelUpdate {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: Option<i32>,
}
