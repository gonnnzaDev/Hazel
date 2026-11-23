use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct JoinRequest {
    /// Único nombre público del miembro; de él se deriva el identificador interno.
    pub name: String,
}
