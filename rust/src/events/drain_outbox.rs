use sqlx::PgPool;
use uuid::Uuid;

use crate::error::ApiResult;
use crate::models::OutboxRow;

use super::*;

pub async fn drain_outbox(pool: &PgPool, bus: &EventBus, kafka: &KafkaFanout) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    let rows: Vec<OutboxRow> = sqlx::query_as(
        "SELECT id, event_type, server_id, channel_id, data FROM outbox_events \
         ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED",
    )
    .fetch_all(&mut *tx)
    .await?;
    if rows.is_empty() {
        tx.commit().await?;
        return Ok(());
    }
    for row in &rows {
        let event = envelope(
            &row.event_type,
            row.server_id,
            row.channel_id,
            row.data.clone(),
        );
        bus.publish(row.server_id, row.channel_id, event.clone())
            .await;
        kafka.publish(event).await;
    }
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    sqlx::query("DELETE FROM outbox_events WHERE id = ANY($1)")
        .bind(&ids)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
