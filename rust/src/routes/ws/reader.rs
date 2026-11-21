use futures::StreamExt;
use std::time::Instant;

use axum::extract::ws::{Message, WebSocket};

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::state::AppState;

use super::*;

pub(crate) async fn reader_loop(
    state: &AppState,
    mut receiver: futures::stream::SplitStream<WebSocket>,
    member: &MemberRow,
    sub: &Arc<Subscription>,
) {
    let mut typing = TypingWindow::new();
    let timeout = Duration::from_secs(state.settings.websocket_idle_timeout_seconds);
    loop {
        let frame = match tokio::time::timeout(timeout, receiver.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => text.to_string(),
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Err(_) => break,
            _ => continue,
        };
        let Ok(payload) = serde_json::from_str::<Value>(&frame) else {
            continue;
        };
        if !payload.is_object() {
            continue;
        }
        let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "heartbeat" => {
                state.bus.direct(sub, json!({ "type": "heartbeat" })).await;
            }
            "channel.subscribe" => {
                let Some(raw) = payload.get("channel_id").and_then(Value::as_str) else {
                    publish_error(state, member.server_id, "invalid_channel_subscribe").await;
                    continue;
                };
                let Ok(channel_id) = Uuid::parse_str(raw) else {
                    publish_error(state, member.server_id, "invalid_channel_subscribe").await;
                    continue;
                };
                let channel: Option<ChannelRow> = sqlx::query_as(
                    "SELECT id, server_id, name, kind::text AS kind, topic, position, is_default \
                     FROM channels WHERE id = $1",
                )
                .bind(channel_id)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
                if let Some(channel) = channel {
                    if channel.server_id == member.server_id {
                        state.bus.subscribe_channel(sub, channel.id).await;
                        state
                            .bus
                            .publish(
                                member.server_id,
                                Some(channel.id),
                                envelope(
                                    "channel.subscribed",
                                    member.server_id,
                                    Some(channel.id),
                                    json!({ "channel_id": channel.id.to_string() }),
                                ),
                            )
                            .await;
                    }
                }
            }
            "channel.unsubscribe" => {
                let Some(raw) = payload.get("channel_id").and_then(Value::as_str) else {
                    publish_error(state, member.server_id, "invalid_channel_unsubscribe").await;
                    continue;
                };
                let Ok(channel_id) = Uuid::parse_str(raw) else {
                    publish_error(state, member.server_id, "invalid_channel_unsubscribe").await;
                    continue;
                };
                if state.bus.is_subscribed(sub, channel_id).await {
                    state.bus.unsubscribe_channel(sub, channel_id).await;
                    state
                        .bus
                        .publish(
                            member.server_id,
                            Some(channel_id),
                            envelope(
                                "channel.unsubscribed",
                                member.server_id,
                                Some(channel_id),
                                json!({ "channel_id": channel_id.to_string() }),
                            ),
                        )
                        .await;
                }
            }
            "typing.start" => {
                let Some(raw) = payload.get("channel_id").and_then(Value::as_str) else {
                    continue;
                };
                let Ok(channel_id) = Uuid::parse_str(raw) else {
                    continue;
                };
                if !state.bus.is_subscribed(sub, channel_id).await {
                    continue;
                }
                if typing.admit(Instant::now(), state.settings.typing_rate_per_minute) {
                    state
                        .bus
                        .publish(
                            member.server_id,
                            Some(channel_id),
                            envelope(
                                "typing.start",
                                member.server_id,
                                Some(channel_id),
                                json!({ "nickname": member.nickname }),
                            ),
                        )
                        .await;
                }
            }
            _ => {
                state
                    .bus
                    .publish(
                        member.server_id,
                        None,
                        envelope(
                            "error",
                            member.server_id,
                            None,
                            json!({
                                "code": "unknown_event_type",
                                "detail": format!("Unsupported event type: {kind}"),
                            }),
                        ),
                    )
                    .await;
            }
        }
    }
}
