use serde_json::{json, Value};
use uuid::Uuid;

pub fn envelope(event_type: &str, server_id: Uuid, channel_id: Option<Uuid>, data: Value) -> Value {
    let mut event = json!({
        "type": event_type,
        "server_id": server_id.to_string(),
        "data": if data.is_null() { json!({}) } else { data },
    });
    if let Some(channel_id) = channel_id {
        event["channel_id"] = json!(channel_id.to_string());
    }
    event
}
