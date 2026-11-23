use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct MeUpdate {
    pub name: String,
}
