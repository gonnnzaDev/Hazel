use uuid::Uuid;

pub fn new_id() -> Uuid {
    Uuid::now_v7()
}

pub fn utcnow() -> chrono::DateTime<chrono::Utc> {
    chrono::Utc::now()
}
