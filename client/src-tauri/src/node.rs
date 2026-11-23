//! Arranque del nodo bajo demanda: el cliente levanta el stack local cuando el
//! usuario va a crear un servidor y todavía no hay un nodo respondiendo.

use std::env;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_PORT: u16 = 7272;

fn repo_root() -> Option<PathBuf> {
    let mut dir = env::var_os("HAZEL_ENV_PATH")
        .map(PathBuf::from)
        .or_else(|| env::current_dir().ok())?;
    for _ in 0..6 {
        if dir.join(".env").is_file() {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn node_port(root: &Path) -> u16 {
    let content = std::fs::read_to_string(root.join(".env")).unwrap_or_default();
    for line in content.lines() {
        if let Some(value) = line.trim().strip_prefix("HAZEL_PORT=") {
            if let Ok(port) = value.trim().parse() {
                return port;
            }
        }
    }
    DEFAULT_PORT
}

fn python() -> Option<&'static str> {
    ["python3", "python"].into_iter().find(|name| {
        Command::new(name)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

fn node_ready(port: u16) -> bool {
    let address = format!("127.0.0.1:{port}");
    let socket = match address
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
    {
        Some(socket) => socket,
        None => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&socket, Duration::from_millis(400)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buffer = [0u8; 64];
    match stream.read(&mut buffer) {
        Ok(read) => read > 0 && buffer[..read].starts_with(b"HTTP/1.1 200"),
        Err(_) => false,
    }
}

/// Devuelve `true` si tuvo que iniciar el nodo, `false` si ya estaba levantado.
#[tauri::command]
pub fn ensure_node() -> Result<bool, String> {
    let root = repo_root().ok_or_else(|| {
        "No se encontró el .env del repo. Abre el cliente desde Hazel o define HAZEL_ENV_PATH."
            .to_string()
    })?;
    let port = node_port(&root);
    if node_ready(port) {
        return Ok(false);
    }
    let python =
        python().ok_or_else(|| "No se encontró Python 3 para ejecutar composer.".to_string())?;

    let services = Command::new(python)
        .args(["-m", "composer", "up"])
        .current_dir(&root)
        .output()
        .map_err(|error| format!("No se pudieron iniciar los servicios: {error}"))?;
    if !services.status.success() {
        let detail = String::from_utf8_lossy(&services.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "No se pudieron iniciar Postgres y Kafka.".to_string()
        } else {
            detail
        });
    }

    Command::new(python)
        .args(["-m", "composer", "api"])
        .current_dir(&root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("No se pudo iniciar el nodo: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        if node_ready(port) {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err("El nodo no respondió a tiempo. Revisa `python -m composer logs kafka`.".to_string())
}
