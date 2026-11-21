use serde::Deserialize;

use super::defaults::default_ttl;

#[derive(Debug, Deserialize, Default)]
pub struct InviteCreate {
    #[serde(default = "default_ttl")]
    pub ttl_seconds: i64,
    #[serde(default)]
    pub single_use: bool,
    #[serde(default)]
    pub password: Option<String>,
}
