use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
pub struct ServerUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub max_members: Option<i16>,
}
