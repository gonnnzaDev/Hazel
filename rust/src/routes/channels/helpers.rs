use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

pub(crate) fn require_same_server(member_server: Uuid, server_id: Uuid) -> ApiResult<()> {
    if member_server != server_id {
        return Err(ApiError::forbidden("This token belongs to another server.")
            .with("code", "wrong_server")
            .with("server_id", server_id.to_string()));
    }
    Ok(())
}

pub(crate) fn clean_name(raw: &str) -> ApiResult<String> {
    let name = raw.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(ApiError::request_validation(
            json!([{"loc":["body","name"]}]),
        ));
    }
    Ok(name.to_string())
}

pub(crate) async fn name_taken(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    name: &str,
    exclude: Option<Uuid>,
) -> ApiResult<bool> {
    let taken: bool = match exclude {
        Some(id) => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM channels WHERE server_id = $1 AND name = $2 AND id <> $3)",
        )
        .bind(server_id)
        .bind(name)
        .bind(id)
        .fetch_one(pool)
        .await?,
        None => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM channels WHERE server_id = $1 AND name = $2)",
            )
            .bind(server_id)
            .bind(name)
            .fetch_one(pool)
            .await?
        }
    };
    Ok(taken)
}
