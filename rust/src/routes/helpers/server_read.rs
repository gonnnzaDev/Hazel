use sqlx::PgPool;

use crate::error::ApiResult;
use crate::models::*;

use super::*;

pub(crate) async fn server_read(pool: &PgPool, row: &ServerRow) -> ApiResult<ServerRead> {
    Ok(ServerRead {
        name: row.name.clone(),
        slug: row.slug.clone(),
        description: row.description.clone(),
        id: row.id,
        status: row.status()?,
        max_members: row.max_members,
        last_heartbeat_at: row.last_heartbeat_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        channels: load_channels(pool, row.id).await?,
    })
}
