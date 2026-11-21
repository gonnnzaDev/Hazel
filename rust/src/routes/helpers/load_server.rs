use sqlx::PgPool;

use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::models::*;

use super::*;

pub(crate) async fn load_server(pool: &PgPool, id: Uuid) -> ApiResult<ServerRow> {
    let sql = format!("SELECT {SERVER_COLUMNS} FROM servers WHERE id = $1");
    let row = sqlx::query_as::<_, ServerRow>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found("The server does not exist.")
            .with("code", "server_not_found")
            .with("server_id", id.to_string())
    })
}
