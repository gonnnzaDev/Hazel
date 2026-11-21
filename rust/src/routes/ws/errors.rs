use serde_json::json;
use uuid::Uuid;

use crate::state::AppState;

use super::*;

pub(crate) async fn publish_error(state: &AppState, server_id: Uuid, code: &str) {
    state
        .bus
        .publish(
            server_id,
            None,
            envelope(
                "error",
                server_id,
                None,
                json!({ "code": code, "detail": "channel_id must be a uuid" }),
            ),
        )
        .await;
}
