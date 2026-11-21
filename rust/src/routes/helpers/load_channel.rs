use sqlx::PgPool;

use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::models::*;

use super::*;

pub(crate) async fn load_channel(
    pool: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
) -> ApiResult<ChannelRow> {
    let sql = format!("SELECT {CHANNEL_COLUMNS} FROM channels WHERE id = $1 AND server_id = $2");
    let row = sqlx::query_as::<_, ChannelRow>(&sql)
        .bind(channel_id)
        .bind(server_id)
        .fetch_optional(pool)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found("That channel does not exist in this server.")
            .with("code", "channel_not_found")
            .with("channel_id", channel_id.to_string())
            .with("server_id", server_id.to_string())
    })
}
