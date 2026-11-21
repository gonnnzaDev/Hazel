use sqlx::PgPool;

use uuid::Uuid;

use crate::error::ApiResult;
use crate::models::*;

use super::*;

pub(crate) async fn load_channels(pool: &PgPool, server_id: Uuid) -> ApiResult<Vec<ChannelRead>> {
    let sql = format!(
        "SELECT {CHANNEL_COLUMNS} FROM channels WHERE server_id = $1 ORDER BY position, name"
    );
    let rows = sqlx::query_as::<_, ChannelRow>(&sql)
        .bind(server_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}
