use chrono::Duration as ChronoDuration;

use serde_json::json;
use sqlx::Transaction;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

use super::*;

pub(crate) fn clean_display_name(raw: Option<String>, fallback: &str) -> ApiResult<String> {
    match raw {
        None => Ok(fallback.to_string()),
        Some(value) => {
            let cleaned = value.trim();
            if cleaned.is_empty() || cleaned.len() > 64 {
                return Err(ApiError::request_validation(
                    json!([{"loc":["body","display_name"]}]),
                ));
            }
            Ok(cleaned.to_string())
        }
    }
}

pub(crate) async fn load_member_tx(
    tx: &mut Transaction<'_, sqlx::Postgres>,
    id: Uuid,
) -> ApiResult<MemberRow> {
    let sql = format!("SELECT {MEMBER_COLUMNS} FROM members WHERE id = $1");
    let row = sqlx::query_as::<_, MemberRow>(&sql)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found("That member does not exist on this server.")
            .with("code", "member_not_found")
            .with("member_id", id.to_string())
    })
}

pub(crate) async fn load_member_by_nickname(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    nickname: &str,
) -> ApiResult<MemberRow> {
    let canonical = normalize_nickname(nickname);
    let sql =
        format!("SELECT {MEMBER_COLUMNS} FROM members WHERE server_id = $1 AND nickname = $2");
    let row = sqlx::query_as::<_, MemberRow>(&sql)
        .bind(server_id)
        .bind(&canonical)
        .fetch_optional(pool)
        .await?;
    row.ok_or_else(|| {
        ApiError::not_found(format!(
            "No one with nickname '{canonical}' is on this server."
        ))
        .with("code", "member_not_found_by_nickname")
        .with("nickname", canonical)
    })
}

pub(crate) async fn issue_token(
    tx: &mut Transaction<'_, sqlx::Postgres>,
    member_id: Uuid,
    server_id: Uuid,
) -> ApiResult<TokenResponse> {
    let (raw, hash) = generate_token();
    let expires_at = utcnow() + ChronoDuration::days(TOKEN_TTL_DAYS);
    sqlx::query(
        "INSERT INTO member_tokens (id, member_id, server_id, token_hash, expires_at, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, now(), now())",
    )
    .bind(new_id())
    .bind(member_id)
    .bind(server_id)
    .bind(hash)
    .bind(expires_at)
    .execute(&mut **tx)
    .await?;
    Ok(TokenResponse {
        token: raw,
        expires_at: Some(expires_at),
    })
}

pub(crate) fn server_summary(row: &ServerRow) -> ServerSummary {
    ServerSummary {
        id: row.id.to_string(),
        slug: row.slug.clone(),
        name: row.name.clone(),
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────
