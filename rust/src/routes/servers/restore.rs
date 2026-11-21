use std::path::{Path as StdPath, PathBuf};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::Value;

use crate::auth::AdminAuth;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::*;

pub(crate) async fn restore_backup(
    State(state): State<Arc<AppState>>,
    _admin: AdminAuth,
    Path(raw_id): Path<String>,
    JsonBody(payload): JsonBody<RestoreRequest>,
) -> ApiResult<Json<ServerRead>> {
    let id = path_uuid(&raw_id)?;
    let server = load_server(&state.pool, id).await?;
    let base = backup_dir(&state, id);
    let base_canonical = base.canonicalize().unwrap_or_else(|_| base.clone());

    let path = if let Some(backup_id) = &payload.backup_id {
        base.join(format!("{backup_id}.dump"))
    } else if let Some(raw) = &payload.path {
        let resolved = StdPath::new(raw)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(raw));
        if resolved.parent() != Some(base_canonical.as_path()) {
            return Err(ApiError::validation(
                "Backup path must be within the server backup directory.",
            )
            .with("code", "invalid_backup_path"));
        }
        resolved
    } else {
        return Err(ApiError::validation("Provide backup_id or path.")
            .with("code", "invalid_restore_request"));
    };
    let path = path.canonicalize().unwrap_or(path);
    if !path.is_file() {
        return Err(ApiError::not_found("Backup not found.")
            .with("code", "backup_not_found")
            .with("path", path.to_string_lossy().to_string()));
    }
    let manifest = path.with_extension("json");
    let data: Value = serde_json::from_slice(&std::fs::read(&manifest).map_err(|_| {
        ApiError::new(
            422,
            "invalid_backup_file",
            "Invalid data",
            "Invalid backup file.",
        )
    })?)
    .map_err(|_| {
        ApiError::new(
            422,
            "invalid_backup_file",
            "Invalid data",
            "Invalid backup file.",
        )
    })?;
    if data.get("server_id").and_then(Value::as_str) != Some(id.to_string().as_str()) {
        return Err(
            ApiError::validation("Backup does not belong to this server.")
                .with("code", "backup_server_mismatch")
                .with("server_id", id.to_string()),
        );
    }
    let (dsn, env) = pg_dsn(&state)?;
    let args = vec![
        format!("--dbname={dsn}"),
        "--clean".to_string(),
        "--if-exists".to_string(),
        path.to_string_lossy().to_string(),
    ];
    run_pg_tool("pg_restore", &args, &env).await?;
    let fresh = load_server(&state.pool, server.id).await.unwrap_or(server);
    Ok(Json(server_read(&state.pool, &fresh).await?))
}

// ─── Invitaciones ────────────────────────────────────────────────────────────
