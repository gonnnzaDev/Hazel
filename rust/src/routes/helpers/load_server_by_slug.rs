use sqlx::PgPool;

use crate::error::{ApiError, ApiResult};
use crate::models::*;

use super::*;

pub(crate) async fn load_server_by_slug(pool: &PgPool, slug: &str) -> ApiResult<ServerRow> {
    let sql = format!("SELECT {SERVER_COLUMNS} FROM servers WHERE slug = $1");
    let row = sqlx::query_as::<_, ServerRow>(&sql)
        .bind(slug)
        .fetch_optional(pool)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found(format!("No server found with identifier '{slug}'."))
            .with("code", "server_not_found_by_slug")
            .with("slug", slug)
    })
}
