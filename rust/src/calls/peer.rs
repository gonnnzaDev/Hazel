use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};

pub struct Peer {
    pub member_id: String,
    pub nickname: String,
    pub display_name: String,
    pub state: Mutex<(bool, bool)>, // (mic, cam)
    pub send: mpsc::Sender<Value>,
}

impl Peer {
    pub async fn public(&self) -> Value {
        let (mic, cam) = *self.state.lock().await;
        json!({
            "member_id": self.member_id,
            "nickname": self.nickname,
            "display_name": self.display_name,
            "mic": mic,
            "cam": cam,
        })
    }
}
