use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ServerSummary {
    pub id: String,
    pub slug: String,
    pub name: String,
}
