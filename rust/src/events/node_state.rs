use serde_json::{json, Value};

pub fn node_state(state: &str, data: Value) -> Value {
    let mut extra = json!({ "state": state });
    if let (Value::Object(target), Value::Object(source)) = (&mut extra, &data) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    extra
}
