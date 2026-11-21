use std::collections::HashSet;
use std::sync::atomic::AtomicBool;

use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

pub struct Subscription {
    pub id: Uuid,
    pub server_id: Uuid,
    pub member_id: Uuid,
    pub nickname: String,
    pub display_name: Option<String>,
    pub channels: Mutex<HashSet<Uuid>>,
    pub tx: broadcast::Sender<Value>,
    pub closed: AtomicBool,
}

impl Subscription {
    pub fn public(&self) -> Value {
        json!({
            "member_id": self.member_id.to_string(),
            "nickname": self.nickname,
            "display_name": self.display_name,
            "mic": true,
            "cam": false,
        })
    }
}
