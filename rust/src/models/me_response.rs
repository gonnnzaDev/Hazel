use serde::Serialize;

use super::*;

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub member: MemberRead,
    pub server: ServerSummary,
}
