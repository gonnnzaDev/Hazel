use serde::Deserialize;

use super::defaults::default_max_members;

#[derive(Debug, Deserialize)]
pub struct ServerCreate {
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub description: Option<String>,
    pub owner_nickname: String,
    #[serde(default = "default_max_members")]
    pub max_members: i32,
}
