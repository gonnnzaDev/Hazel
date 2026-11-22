//! Detección de dependencias para arrancar Hazel al 100%.
//!
//! No instala nada: comprueba qué falta y devuelve el comando exacto para
//! cada sistema operativo. La elevación de permisos la hace el usuario.

use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Dependency {
    pub name: String,
    pub present: bool,
    pub why: String,
    pub install: String,
}

fn output_ok(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn has_command(name: &str) -> bool {
    if cfg!(windows) {
        output_ok("where", &[name])
    } else {
        output_ok("which", &[name])
    }
}

fn has_pkg_config(package: &str) -> bool {
    has_command("pkg-config") && output_ok("pkg-config", &["--exists", package])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Distro {
    Arch,
    Debian,
    Fedora,
    Suse,
    Alpine,
    Unknown,
}

fn linux_distro() -> Distro {
    let raw = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let field = |key: &str| -> String {
        raw.lines()
            .find_map(|line| line.strip_prefix(key))
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_lowercase()
    };
    let id = field("ID=");
    let like = field("ID_LIKE=");
    let text = format!("{id} {like}");
    if text.contains("arch") || text.contains("manjaro") {
        Distro::Arch
    } else if text.contains("debian") || text.contains("ubuntu") || text.contains("linuxmint") {
        Distro::Debian
    } else if text.contains("fedora") || text.contains("rhel") || text.contains("centos") {
        Distro::Fedora
    } else if text.contains("suse") {
        Distro::Suse
    } else if text.contains("alpine") {
        Distro::Alpine
    } else {
        Distro::Unknown
    }
}

fn add(
    list: &mut Vec<Dependency>,
    name: &str,
    present: bool,
    why: &str,
    install: impl Into<String>,
) {
    if !present {
        list.push(Dependency {
            name: name.to_string(),
            present,
            why: why.to_string(),
            install: install.into(),
        });
    }
}

/// Devuelve solo las dependencias que faltan.
#[tauri::command]
pub fn check_dependencies() -> Vec<Dependency> {
    let mut missing = Vec::new();

    // ─── Comunes a todos los sistemas ───────────────────────────────────
    let python = has_command("python3") || has_command("python");
    add(
        &mut missing,
        "Python 3",
        python,
        "composer construye el nodo, aplica migraciones y gestiona contenedores",
        "https://www.python.org/downloads/",
    );

    let rust = has_command("cargo") && has_command("rustc");
    add(
        &mut missing,
        "Rust",
        rust,
        "compila el nodo y el cliente Tauri",
        "https://rustup.rs/",
    );

    let node = has_command("node") && has_command("npm");
    add(
        &mut missing,
        "Node.js + npm",
        node,
        "compila el frontend del cliente",
        "https://nodejs.org/",
    );

    let docker_cli = has_command("docker");
    let docker_daemon = docker_cli && output_ok("docker", &["info"]);
    let docker_install = match linux_distro() {
        Distro::Arch => "sudo pacman -S docker && sudo systemctl enable --now docker && sudo usermod -aG docker $USER",
        Distro::Debian => "sudo apt update && sudo apt install -y docker.io && sudo systemctl enable --now docker && sudo usermod -aG docker $USER",
        Distro::Fedora => "sudo dnf install -y docker && sudo systemctl enable --now docker && sudo usermod -aG docker $USER",
        Distro::Suse => "sudo zypper install -y docker && sudo systemctl enable --now docker && sudo usermod -aG docker $USER",
        Distro::Alpine => "sudo apk add docker && rc-update add docker default && rc-service docker start && addgroup $USER docker",
        Distro::Unknown => "Instala Docker Engine desde https://docs.docker.com/engine/install/",
    };
    add(
        &mut missing,
        "Docker",
        docker_cli,
        "ejecuta PostgreSQL y Kafka; sin él el nodo no puede arrancar",
        if cfg!(windows) {
            "winget install Docker.DockerDesktop"
        } else if cfg!(target_os = "macos") {
            "brew install --cask docker"
        } else {
            docker_install
        },
    );
    add(
        &mut missing,
        "Docker en marcha",
        docker_daemon,
        "el daemon debe responder para levantar los contenedores",
        if cfg!(windows) {
            "Abre Docker Desktop y espera a que esté running"
        } else if cfg!(target_os = "macos") {
            "open -a Docker"
        } else {
            "sudo systemctl enable --now docker  (y vuelve a iniciar sesión)"
        },
    );

    let build_tool = has_command("cmake") || has_command("ninja");
    add(
        &mut missing,
        "cmake o ninja",
        build_tool,
        "rdkafka compila librdkafka durante el build del nodo",
        match linux_distro() {
            Distro::Arch => "sudo pacman -S cmake",
            Distro::Debian => "sudo apt install -y cmake ninja-build",
            Distro::Fedora => "sudo dnf install -y cmake ninja-build",
            Distro::Suse => "sudo zypper install -y cmake ninja",
            Distro::Alpine => "sudo apk add cmake ninja",
            Distro::Unknown => "Instala cmake desde el gestor de paquetes de tu distro",
        },
    );

    // ─── Específicas de Linux (Tauri / WebKitGTK) ────────────────────────
    #[cfg(target_os = "linux")]
    {
        let webkit = has_pkg_config("javascriptcoregtk-4.1")
            && has_pkg_config("webkit2gtk-4.1")
            && has_pkg_config("gtk+-3.0");
        let indicator = has_pkg_config("ayatana-appindicator3-0.1")
            || has_pkg_config("appindicator3-0.1");
        let rsvg = has_pkg_config("librsvg-2.0");

        let (webkit_cmd, indicator_cmd, rsvg_cmd) = match linux_distro() {
            Distro::Arch => (
                "sudo pacman -S webkit2gtk-4.1 gtk3 base-devel",
                "sudo pacman -S libayatana-appindicator",
                "sudo pacman -S librsvg",
            ),
            Distro::Debian => (
                "sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev build-essential",
                "sudo apt install -y libayatana-appindicator3-dev",
                "sudo apt install -y librsvg2-dev",
            ),
            Distro::Fedora => (
                "sudo dnf install -y webkit2gtk4.1-devel gtk3-devel @development-tools",
                "sudo dnf install -y libappindicator-gtk3-devel",
                "sudo dnf install -y librsvg2-devel",
            ),
            Distro::Suse => (
                "sudo zypper install -y webkit2gtk4.1-devel gtk3-devel patterns-devel-base-devel_basis",
                "sudo zypper install -y libayatana-appindicator3-devel",
                "sudo zypper install -y librsvg2-devel",
            ),
            Distro::Alpine => (
                "sudo apk add webkit2gtk-dev gtk3-dev build-base",
                "sudo apk add libayatana-appindicator-dev",
                "sudo apk add librsvg-dev",
            ),
            Distro::Unknown => (
                "Instala WebKitGTK 4.1 y GTK3 desde tu gestor de paquetes",
                "Instala libayatana-appindicator",
                "Instala librsvg",
            ),
        };

        add(
            &mut missing,
            "WebKitGTK + GTK3",
            webkit,
            "renderiza la ventana del cliente en Linux",
            webkit_cmd,
        );
        add(
            &mut missing,
            "Indicador de bandeja",
            indicator,
            "icono de bandeja de Tauri en Linux",
            indicator_cmd,
        );
        add(
            &mut missing,
            "librsvg",
            rsvg,
            "procesa los iconos del bundle",
            rsvg_cmd,
        );
    }

    // ─── Específicas de macOS ────────────────────────────────────────────
    #[cfg(target_os = "macos")]
    {
        let xcode = output_ok("xcode-select", &["-p"]);
        add(
            &mut missing,
            "Xcode Command Line Tools",
            xcode,
            "compila el crate Tauri en macOS",
            "xcode-select --install",
        );
    }

    // ─── Específicas de Windows ──────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        add(
            &mut missing,
            "WebView2 Runtime",
            has_command("msedgewebview2"),
            "motor de renderizado del cliente en Windows",
            "winget install Microsoft.EdgeWebView2Runtime",
        );
        add(
            &mut missing,
            "MSVC Build Tools",
            has_command("cl"),
            "toolchain nativa para compilar Tauri en Windows",
            "winget install Microsoft.VisualStudio.2022.BuildTools",
        );
    }

    missing
}
