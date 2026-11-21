use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct RestoreRequest {
    pub backup_id: Option<String>,
    pub path: Option<String>,
}
