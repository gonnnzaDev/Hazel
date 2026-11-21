use serde_json::Value;

pub fn parse_signal(raw: &str) -> Option<Value> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .filter(|v| v.is_object())
}
