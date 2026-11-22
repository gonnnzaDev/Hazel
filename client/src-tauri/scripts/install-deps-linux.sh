#!/bin/sh
# Instala todas las dependencias de Hazel (cliente + nodo) en Linux.
# Se ejecuta con privilegios de administrador desde el cliente Tauri.
set -eu

log() { printf '[hazel] %s\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if [ ! -f /etc/os-release ]; then
  log "No se pudo detectar la distribución (/etc/os-release)."
  exit 1
fi
. /etc/os-release

log "Sistema detectado: $PRETTY_NAME"

case "$ID" in
  arch|manjaro|endeavouros)
    $SUDO pacman -Syu --noconfirm python nodejs npm docker cmake base-devel \
      webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg
    ;;
  debian|ubuntu|linuxmint|pop|raspbian)
    $SUDO apt-get update
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y \
      python3 python3-pip nodejs npm docker.io cmake build-essential \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
    ;;
  fedora|rhel|centos|rocky|almalinux)
    $SUDO dnf install -y python3 python3-pip nodejs npm docker cmake \
      @development-tools webkit2gtk4.1-devel gtk3-devel \
      libappindicator-gtk3-devel librsvg2-devel
    ;;
  opensuse*|sles)
    $SUDO zypper --non-interactive install python3 python3-pip nodejs npm docker cmake \
      patterns-devel-base-devel_basis webkit2gtk4.1-devel gtk3-devel \
      libayatana-appindicator3-devel librsvg2-devel
    ;;
  alpine)
    $SUDO apk add --no-cache python3 py3-pip nodejs npm docker cmake build-base \
      webkit2gtk-dev gtk3-dev libayatana-appindicator-dev librsvg-dev
    ;;
  *)
    log "Distribución no soportada automáticamente: $ID"
    log "Instala manualmente: python3, nodejs+npm, docker, cmake, WebKitGTK 4.1, GTK3, appindicator y librsvg."
    exit 1
    ;;
esac

if ! command -v cargo >/dev/null 2>&1; then
  log "Instalando Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

if command -v systemctl >/dev/null 2>&1; then
  log "Habilitando Docker..."
  $SUDO systemctl enable --now docker >/dev/null 2>&1 || log "No se pudo iniciar docker.service"
  if [ -n "${SUDO}" ] && [ -n "${USER:-}" ]; then
    $SUDO usermod -aG docker "$USER" >/dev/null 2>&1 || log "No se pudo añadir $USER al grupo docker"
  fi
fi
if command -v rc-update >/dev/null 2>&1; then
  $SUDO rc-update add docker default >/dev/null 2>&1 || true
  $SUDO rc-service docker start >/dev/null 2>&1 || true
  $SUDO addgroup "$USER" docker >/dev/null 2>&1 || true
fi

log "Dependencias instaladas."
