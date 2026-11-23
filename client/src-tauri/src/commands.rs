//! Persistencia local de la sesión. Los tokens nunca se imprimen ni se registran.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JoinedServer {
    pub server_id: String,
    pub token: String,
    pub base_url: String,
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct StoredSession {
    pub token: String,
    pub base_url: String,
    #[serde(default)]
    pub joined: Vec<JoinedServer>,
}

fn session_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn load_session(app: AppHandle) -> Result<Option<StoredSession>, String> {
    let path = session_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let session = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(session))
}

#[tauri::command]
pub fn save_session(
    app: AppHandle,
    token: String,
    base_url: String,
    joined: Vec<JoinedServer>,
) -> Result<(), String> {
    let path = session_file(&app)?;
    let session = StoredSession {
        token,
        base_url,
        joined,
    };
    let content = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    restrict_permissions(&path)
}

/// Lee `HAZEL_ADMIN_TOKEN` del `.env` del repo para no pedirlo a mano.
/// Busca desde `HAZEL_ENV_PATH` o desde el directorio actual hacia arriba.
/// El valor nunca se imprime ni se registra.
#[tauri::command]
pub fn read_admin_token() -> Option<String> {
    let mut dir = std::env::var_os("HAZEL_ENV_PATH")
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())?;

    for _ in 0..6 {
        let candidate = dir.join(".env");
        if let Ok(content) = fs::read_to_string(&candidate) {
            for line in content.lines() {
                let line = line.trim();
                if let Some(value) = line.strip_prefix("HAZEL_ADMIN_TOKEN=") {
                    let value = value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
                    if !value.is_empty() {
                        return Some(value.to_string());
                    }
                }
            }
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

/// Cierra la sesión activa pero conserva el registro de servidores ya unidos.
#[tauri::command]
pub fn clear_session(app: AppHandle) -> Result<(), String> {
    let path = session_file(&app)?;
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut session: StoredSession = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    session.token.clear();
    session.base_url.clear();
    let content = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    restrict_permissions(&path)
}
