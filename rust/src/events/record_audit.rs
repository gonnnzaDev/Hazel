use serde_json::Value;
use uuid::Uuid;

use crate::error::ApiResult;

pub async fn record_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    server_id: Uuid,
    actor_nickname: Option<&str>,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    data: Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO audit_events (id, server_id, actor_nickname, action, target_type, target_id, data, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
    )
    .bind(Uuid::now_v7())
    .bind(server_id)
    .bind(actor_nickname)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(data)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
