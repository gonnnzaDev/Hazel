use chrono::{DateTime, Utc};

pub fn now_iso() -> DateTime<Utc> {
    Utc::now()
}
