use std::path::{Path as StdPath, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::Json;
use chrono::SecondsFormat;
use serde_json::json;
use uuid::Uuid;

use crate::auth::ServerAuth;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) fn pg_dsn(
    state: &AppState,
) -> ApiResult<(String, std::collections::HashMap<String, String>)> {
    let url = url::Url::parse(&state.settings.sync_database_url()).map_err(|_| {
        ApiError::new(
            422,
            "backup_requires_postgres",
            "Domain error",
            "Backups require PostgreSQL.",
        )
    })?;
    if !url.scheme().starts_with("postgresql") {
        return Err(ApiError::new(
            422,
            "backup_requires_postgres",
            "Domain error",
            "Backups require PostgreSQL.",
        ));
    }
    let username = url.username();
    let host = url.host_str().unwrap_or("localhost");
    let port = url.port().unwrap_or(5432);
    let path = url.path();
    let dsn = format!("postgresql://{username}@{host}:{port}{path}");
    let mut env: std::collections::HashMap<String, String> = std::env::vars().collect();
    if let Some(password) = url.password() {
        env.insert("PGPASSWORD".to_string(), password.to_string());
    }
    Ok((dsn, env))
}

pub(crate) async fn run_pg_tool(
    program: &str,
    args: &[String],
    env: &std::collections::HashMap<String, String>,
) -> ApiResult<()> {
    let output = tokio::process::Command::new(program)
        .args(args)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| {
            ApiError::new(
                500,
                "backup_tool_failed",
                "Domain error",
                format!("{program} failed: {error}"),
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let tail: String = stderr
            .chars()
            .rev()
            .take(500)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(ApiError::new(
            500,
            "backup_tool_failed",
            "Domain error",
            format!("{program} failed: {tail}"),
        ));
    }
    Ok(())
}

pub(crate) fn backup_dir(state: &AppState, server_id: Uuid) -> PathBuf {
    StdPath::new(&state.settings.storage_root)
        .join("backups")
        .join(server_id.to_string())
}

pub(crate) fn prune_old_backups(base: &StdPath, days: i64) {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        - days * 86_400;
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            if modified < cutoff {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

pub(crate) async fn create_backup(
    State(state): State<Arc<AppState>>,
    auth: ServerAuth,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<BackupRead>> {
    let id = path_uuid(&raw_id)?;
    auth.check(id)?;
    let server = load_server(&state.pool, id).await?;
    let backup_id = Uuid::new_v4().simple().to_string();
    let created_at = utcnow();
    let base = backup_dir(&state, id);
    std::fs::create_dir_all(&base).map_err(|e| ApiError::internal(e.to_string()))?;
    let dump = base.join(format!("{backup_id}.dump"));
    let manifest = base.join(format!("{backup_id}.json"));
    let (dsn, env) = pg_dsn(&state)?;
    let args = vec![
        format!("--file={}", dump.display()),
        "--format=custom".to_string(),
        dsn,
    ];
    run_pg_tool("pg_dump", &args, &env).await?;
    let manifest_data = json!({
        "backup_id": backup_id,
        "server_id": id.to_string(),
        "slug": server.slug,
        "name": server.name,
        "status": server.status()?.as_str(),
        "created_at": created_at.to_rfc3339_opts(SecondsFormat::Micros, true),
    });
    std::fs::write(
        &manifest,
        serde_json::to_string_pretty(&manifest_data).unwrap_or_default(),
    )
    .map_err(|e| ApiError::internal(e.to_string()))?;
    prune_old_backups(&base, state.settings.backup_retention_days);
    let size = std::fs::metadata(&dump).map(|m| m.len()).unwrap_or(0);
    Ok(Json(BackupRead {
        backup_id,
        path: dump.to_string_lossy().to_string(),
        size,
        created_at,
    }))
}
