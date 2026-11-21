use axum::extract::ws::CloseFrame;

use axum::extract::ws::{Message, WebSocket};

use std::sync::Arc;

use futures::{SinkExt, StreamExt};
use serde_json::json;

use crate::events::EventBus;
use crate::state::AppState;

use super::*;

pub(crate) async fn close_with(socket: &mut WebSocket, code: u16, reason: &str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.to_string().into(),
        })))
        .await;
}

pub(crate) async fn publish_presence(bus: &EventBus, member: &MemberRow, online: bool) {
    let event = envelope(
        "presence.update",
        member.server_id,
        None,
        json!({
            "nickname": member.nickname,
            "display_name": member.display_name,
            "is_online": online,
        }),
    );
    bus.publish(member.server_id, None, event).await;
}

pub(crate) async fn run_socket(state: Arc<AppState>, mut socket: WebSocket, token: String) {
    let member = match authenticate(&state.pool, &token).await {
        Ok(member) => member,
        Err(_) => {
            close_with(&mut socket, 1008, "unauthenticated").await;
            return;
        }
    };
    let server: Option<(String, String, String)> =
        sqlx::query_as("SELECT status::text, slug, name FROM servers WHERE id = $1")
            .bind(member.server_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let Some(server) = server else {
        close_with(&mut socket, 1008, "server_inactive").await;
        return;
    };
    if !server
        .0
        .parse::<ServerStatus>()
        .map(|s| s.accepts_traffic())
        .unwrap_or(false)
    {
        close_with(&mut socket, 1008, "server_inactive").await;
        return;
    }

    let (sub, first_socket) = state
        .bus
        .subscribe(
            member.server_id,
            member.id,
            member.nickname.clone(),
            Some(member.display_name.clone()),
        )
        .await;

    sqlx::query("UPDATE members SET is_online = true, last_seen_at = $2 WHERE id = $1")
        .bind(member.id)
        .bind(utcnow())
        .execute(&state.pool)
        .await
        .ok();
    if first_socket {
        publish_presence(&state.bus, &member, true).await;
    }
    state
        .bus
        .publish(
            member.server_id,
            None,
            envelope(
                "connection.ready",
                member.server_id,
                None,
                json!({
                    "member_id": member.id.to_string(),
                    "nickname": member.nickname,
                    "display_name": member.display_name,
                    "server_id": member.server_id.to_string(),
                    "server_slug": server.1,
                    "server_name": server.2,
                }),
            ),
        )
        .await;

    let (mut sink, stream) = socket.split();
    let tx = sub.tx.clone();
    let writer = tokio::spawn(async move {
        let mut rx = tx.subscribe();
        while let Ok(event) = rx.recv().await {
            if sink
                .send(Message::Text(event.to_string().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    reader_loop(&state, stream, &member, &sub).await;
    writer.abort();

    let was_last = state.bus.unsubscribe(&sub).await;
    if was_last {
        publish_presence(&state.bus, &member, false).await;
    }
    sqlx::query("UPDATE members SET is_online = false, last_seen_at = $2 WHERE id = $1")
        .bind(member.id)
        .bind(utcnow())
        .execute(&state.pool)
        .await
        .ok();
}
