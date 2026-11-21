use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CallParticipant {
    pub member_id: String,
    pub nickname: String,
    pub display_name: String,
    pub mic: bool,
    pub cam: bool,
}
