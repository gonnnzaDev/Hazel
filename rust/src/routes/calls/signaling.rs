use crate::calls::{is_forwardable, parse_signal, Peer};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::state::AppState;

use super::*;

pub(crate) async fn call_signaling(
    State(state): State<Arc<AppState>>,
    Path((server_id, channel_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    upgrade: WebSocketUpgrade,
) -> axum::response::Response {
    upgrade.on_upgrade(move |socket| async move {
        run_call_socket(
            state,
            socket,
            server_id,
            channel_id,
            query.get("token").cloned().unwrap_or_default(),
        )
        .await;
    })
}

pub(crate) async fn run_call_socket(
    state: Arc<AppState>,
    socket: WebSocket,
    server_id: String,
    channel_id: String,
    token: String,
) {
    let mut socket = socket;
    let identity = match resolve_identity(&state, &server_id, &channel_id, &token).await {
        Ok(identity) => identity,
        Err(error) => {
            let reason = error.code.chars().take(120).collect::<String>();
            let _ = socket
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 1008,
                    reason: reason.into(),
                })))
                .await;
            return;
        }
    };

    let (tx, mut rx) = mpsc::channel::<Value>(state.settings.websocket_queue_size);
    let peer = Arc::new(Peer {
        member_id: identity.member_id.clone(),
        nickname: identity.nickname,
        display_name: identity.display_name,
        state: tokio::sync::Mutex::new((true, false)),
        send: tx,
    });

    let existing = state.calls.join(&channel_id, peer.clone()).await;
    let mut peers: Vec<Value> = vec![];
    for item in &existing {
        peers.push(item.public().await);
    }
    let _ = socket
        .send(Message::Text(
            json!({
                "type": "welcome",
                "you": peer.member_id,
                "peers": peers,
                "ice_servers": state.settings.call_ice_servers,
            })
            .to_string()
            .into(),
        ))
        .await;
    state
        .calls
        .broadcast(
            &channel_id,
            json!({ "type": "peer-joined", "peer": peer.public().await }),
            Some(&peer.member_id),
        )
        .await;

    let (mut sink, mut stream) = socket.split();
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sink
                .send(Message::Text(message.to_string().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    while let Some(frame) = stream.next().await {
        let text = match frame {
            Ok(Message::Text(text)) => text.to_string(),
            Ok(Message::Close(_)) | Err(_) => break,
            _ => continue,
        };
        let Some(message) = parse_signal(&text) else {
            continue;
        };
        let Some(kind) = message.get("type").and_then(Value::as_str) else {
            continue;
        };
        if is_forwardable(kind) {
            let Some(target) = message.get("to").and_then(Value::as_str) else {
                continue;
            };
            let payload = if kind == "ice" {
                message.get("candidate")
            } else {
                message.get("sdp")
            };
            state
                .calls
                .send_to(
                    &channel_id,
                    target,
                    json!({ "type": kind, "from": peer.member_id, "payload": payload }),
                )
                .await;
        } else if kind == "state" {
            let (mic, cam) = *peer.state.lock().await;
            let mic = message.get("mic").and_then(Value::as_bool).unwrap_or(mic);
            let cam = message.get("cam").and_then(Value::as_bool).unwrap_or(cam);
            if let Some((mic, cam)) = state
                .calls
                .update_state(&channel_id, &peer.member_id, mic, cam)
                .await
            {
                state
                    .calls
                    .broadcast(
                        &channel_id,
                        json!({ "type": "peer-state", "member_id": peer.member_id, "mic": mic, "cam": cam }),
                        Some(&peer.member_id),
                    )
                    .await;
            }
        }
    }

    writer.abort();
    state.calls.leave(&channel_id, &peer.member_id).await;
    state
        .calls
        .broadcast(
            &channel_id,
            json!({ "type": "peer-left", "member_id": peer.member_id }),
            None,
        )
        .await;
}
