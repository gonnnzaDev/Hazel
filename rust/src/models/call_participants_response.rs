use serde::{Deserialize, Serialize};

use super::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct CallParticipantsResponse {
    pub channel_id: String,
    pub participants: Vec<CallParticipant>,
    pub count: usize,
    pub max: usize,
}
