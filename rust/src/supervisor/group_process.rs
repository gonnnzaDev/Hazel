use chrono::{DateTime, Utc};
use tokio::process::Child;
use uuid::Uuid;

pub struct GroupProcess {
    pub server_id: Uuid,
    pub port: u16,
    pub child: Child,
    pub started_at: DateTime<Utc>,
}

impl GroupProcess {
    pub async fn is_running(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_none()
    }
    pub async fn exit_code(&mut self) -> Option<i32> {
        self.child
            .try_wait()
            .ok()
            .flatten()
            .map(|s| s.code().unwrap_or(-1))
    }
    pub async fn uptime(&self) -> f64 {
        Utc::now()
            .signed_duration_since(self.started_at)
            .num_milliseconds() as f64
            / 1000.0
    }
}
