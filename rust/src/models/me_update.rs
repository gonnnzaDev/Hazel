use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct MeUpdate {
    pub display_name: String,
}
