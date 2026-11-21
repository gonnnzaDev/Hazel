use crate::error::{ApiError, ApiResult};
use crate::models::MemberRow;
use crate::utils::hash_token;
use uuid::Uuid;

pub async fn authenticate(pool: &sqlx::PgPool, raw: &str) -> ApiResult<MemberRow> {
    if raw.is_empty() {
        return Err(ApiError::unauthenticated("Missing token.").with("code", "missing_token"));
    }
    let hash = hash_token(raw);
    let token: Option<(
        Uuid,
        chrono::DateTime<chrono::Utc>,
        Option<chrono::DateTime<chrono::Utc>>,
    )> = sqlx::query_as(
        "SELECT member_id, expires_at, revoked_at FROM member_tokens WHERE token_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;
    let Some((member_id, expires_at, revoked_at)) = token else {
        return Err(
            ApiError::unauthenticated("The token is invalid or expired.")
                .with("code", "invalid_token"),
        );
    };
    if revoked_at.is_some() || expires_at < chrono::Utc::now() {
        return Err(
            ApiError::unauthenticated("The token is invalid or expired.")
                .with("code", "invalid_token"),
        );
    }

    let mut member: MemberRow = sqlx::query_as(
        "SELECT id, server_id, nickname, display_name, role, is_online, last_seen_at, created_at \
         FROM members WHERE id = $1",
    )
    .bind(member_id)
    .fetch_one(pool)
    .await?;

    if !member.is_online {
        member.last_seen_at = Some(chrono::Utc::now());
        sqlx::query("UPDATE members SET last_seen_at = now() WHERE id = $1")
            .bind(member.id)
            .execute(pool)
            .await?;
    }
    Ok(member)
}
