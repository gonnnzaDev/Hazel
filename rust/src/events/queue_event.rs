use serde_json::Value;
use uuid::Uuid;

use crate::error::ApiResult;

pub async fn queue_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_type: &str,
    server_id: Uuid,
    channel_id: Option<Uuid>,
    data: Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO outbox_events (id, event_type, server_id, channel_id, data, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, now(), now())",
    )
    .bind(Uuid::now_v7())
    .bind(event_type)
    .bind(server_id)
    .bind(channel_id)
    .bind(data)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
