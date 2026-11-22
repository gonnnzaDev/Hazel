//! Instalación automática de dependencias al arrancar.
//!
//! Los scripts se embedan en el binario y se ejecutan con elevación. El usuario
//! solo ve el progreso en el splash; no tiene que copiar ni ejecutar nada.

use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Emitter};

#[cfg(target_os = "linux")]
const SCRIPT: &str = include_str!("../scripts/install-deps-linux.sh");
#[cfg(target_os = "macos")]
const SCRIPT: &str = include_str!("../scripts/install-deps-macos.sh");
#[cfg(target_os = "windows")]
const SCRIPT: &str = include_str!("../scripts/install-deps-windows.ps1");

fn script_path() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    let extension = "ps1";
    #[cfg(not(target_os = "windows"))]
    let extension = "sh";

    let dir = std::env::temp_dir().join("hazel-deps");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("install-deps.{extension}"));
    fs::write(&path, SCRIPT).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(path)
}

fn elevated_command(path: &std::path::Path) -> Result<Command, String> {
    #[cfg(target_os = "linux")]
    {
        if libc_geteuid() == 0 {
            let mut command = Command::new("sh");
            command.arg(path);
            return Ok(command);
        }
        if which("pkexec") {
            let mut command = Command::new("pkexec");
            command.arg("sh").arg(path);
            return Ok(command);
        }
        if which("sudo") {
            let mut command = Command::new("sudo");
            command.args(["-n", "sh"]).arg(path);
            return Ok(command);
        }
        Err("No hay pkexec ni sudo disponibles para elevar permisos.".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "do shell script \"sh '{}'\" with administrator privileges",
            path.display()
        );
        let mut command = Command::new("osascript");
        command.args(["-e", &script]);
        Ok(command)
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Start-Process -FilePath powershell -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','{}')",
            path.display()
        );
        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"])
            .arg(script);
        Ok(command)
    }
}

#[cfg(target_os = "linux")]
fn which(program: &str) -> bool {
    Command::new("which")
        .arg(program)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn libc_geteuid() -> u32 {
    // Evitamos añadir la crate libc: /proc/self/status expone el UID real.
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    status
        .lines()
        .find_map(|line| line.strip_prefix("Uid:"))
        .and_then(|value| value.split_whitespace().next())
        .and_then(|value| value.parse().ok())
        .unwrap_or(1000)
}

#[tauri::command]
pub fn install_dependencies(app: AppHandle) -> Result<(), String> {
    let path = script_path()?;
    let mut command = elevated_command(&path)?;

    let _ = app.emit("deps-progress", "Instalando dependencias…");

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit("deps-progress", line);
        }
    }
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app.emit("deps-progress", line);
        }
    }

    let status = child.wait().map_err(|error| error.to_string())?;
    let _ = app.emit("deps-progress", "Comprobando el resultado…");

    if status.success() {
        Ok(())
    } else {
        Err("La instalación terminó con errores. Revisa el registro del splash.".to_string())
    }
}
