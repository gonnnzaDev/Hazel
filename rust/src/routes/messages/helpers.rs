use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn reachable_channel(
    state: &AppState,
    server_id: Uuid,
    channel_id: Uuid,
) -> ApiResult<ChannelRow> {
    let sql = format!("SELECT {CHANNEL_COLUMNS} FROM channels WHERE id = $1 AND server_id = $2");
    let channel = sqlx::query_as::<_, ChannelRow>(&sql)
        .bind(channel_id)
        .bind(server_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| {
            ApiError::not_found("That channel does not exist in this server.")
                .with("code", "channel_not_found")
                .with("channel_id", channel_id.to_string())
        })?;
    let server = load_server(&state.pool, server_id).await?;
    if !server.status()?.accepts_traffic() {
        let state_name = server.status()?.as_str();
        return Err(ApiError::server_inactive(
            "Server is inactive. It accepts no connections until its owner activates it again.",
        )
        .with("server_id", server_id.to_string())
        .with("state", state_name));
    }
    Ok(channel)
}

pub(crate) async fn load_message(pool: &sqlx::PgPool, id: Uuid) -> ApiResult<MessageRow> {
    let sql = format!("SELECT {MESSAGE_COLUMNS} FROM messages WHERE id = $1");
    let row = sqlx::query_as::<_, MessageRow>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found("That message does not exist in this channel.")
            .with("code", "message_not_found")
            .with("message_id", id.to_string())
    })
}

pub(crate) async fn build_read(
    pool: &sqlx::PgPool,
    message: &MessageRow,
) -> ApiResult<MessageRead> {
    let display_name: Option<String> = match message.author_member_id {
        Some(id) => sqlx::query_scalar("SELECT display_name FROM members WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .flatten(),
        None => None,
    };
    let reactions: Vec<(String, String)> = sqlx::query_as(
        "SELECT r.emoji, m.nickname FROM reactions r JOIN members m ON m.id = r.member_id \
         WHERE r.message_id = $1 ORDER BY r.created_at, r.emoji",
    )
    .bind(message.id)
    .fetch_all(pool)
    .await?;
    let attachments: Vec<String> = message
        .attachments
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(MessageRead {
        id: message.id,
        channel_id: message.channel_id,
        author: MessageAuthorRead {
            nickname: message.author_nickname.clone(),
            display_name,
        },
        content: if message.deleted_at.is_some() {
            None
        } else {
            Some(message.content.clone())
        },
        reply_to: message.reply_to,
        attachments,
        reactions: reactions
            .into_iter()
            .map(|(emoji, nickname)| ReactionRead { emoji, nickname })
            .collect(),
        created_at: message.created_at,
        edited_at: message.edited_at,
        deleted: message.deleted_at.is_some(),
    })
}

pub(crate) fn enforce_size(content: &str, max: usize) -> ApiResult<()> {
    let size = content.len(); // UTF-8 bytes
    if size > max {
        return Err(ApiError::new(
            413,
            "message_too_large",
            "Message too large",
            format!("Message is {size} bytes; the limit is {max}."),
        )
        .with("max_message_bytes", max as i64));
    }
    Ok(())
}

pub(crate) fn can_touch(member: &MemberRow, message: &MessageRow) -> bool {
    match message.author_member_id {
        Some(id) => id == member.id,
        None => message.author_nickname == member.nickname,
    }
}

// ─── Mensajes ────────────────────────────────────────────────────────────────
