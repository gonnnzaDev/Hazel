use serde::Deserialize;

use super::*;

use super::defaults::default_channel_kind;

#[derive(Debug, Deserialize)]
pub struct ChannelCreate {
    pub name: String,
    #[serde(default = "default_channel_kind")]
    pub kind: ChannelKind,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub position: Option<i32>,
}
