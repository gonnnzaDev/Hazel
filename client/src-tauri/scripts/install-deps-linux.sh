#!/bin/sh
# Instala todas las dependencias de Hazel (cliente + nodo) en Linux.
# Se ejecuta con privilegios de administrador desde el cliente Tauri.
set -eu

log() { printf '[hazel] %s\n' "$*"; }
# El cliente Tauri lee estas líneas y dibuja la barra de progreso.
progress() { printf '@@HAZEL_PROGRESS@@%s|%s\n' "$1" "$2"; }

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
progress 8 "Sistema detectado"

progress 12 "Instalando paquetes del sistema..."
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

progress 60 "Paquetes del sistema listos"

if ! command -v cargo >/dev/null 2>&1; then
  progress 65 "Instalando Rust..."
  log "Instalando Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

progress 82 "Configurando Docker..."

# pkexec/sudo ejecutan este script como root: $USER suele ser "root". Hay que
# averiguar quién lanzó el cliente para darle acceso a Docker a ÉL.
REAL_USER="${HAZEL_CLIENT_USER:-${SUDO_USER:-}}"
if [ -z "$REAL_USER" ] && [ -n "${PKEXEC_UID:-}" ]; then
  REAL_USER="$(getent passwd "$PKEXEC_UID" 2>/dev/null | cut -d: -f1 || true)"
fi
if [ -z "$REAL_USER" ] && [ -n "${USER:-}" ] && [ "$USER" != "root" ]; then
  REAL_USER="$USER"
fi
[ -n "$REAL_USER" ] && log "Usuario del cliente: $REAL_USER"

# 1) El daemon debe estar levantado.
if command -v systemctl >/dev/null 2>&1; then
  log "Habilitando Docker..."
  $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
fi
if command -v rc-update >/dev/null 2>&1; then
  $SUDO rc-update add docker default >/dev/null 2>&1 || true
  $SUDO rc-service docker start >/dev/null 2>&1 || true
fi

# 2) Esperar a que el socket responda (como root, aún sin permisos de usuario).
attempt=0
while [ $attempt -lt 20 ]; do
  if docker info >/dev/null 2>&1; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done
progress 90 "Docker en marcha"

# 3) Acceso para el usuario real: permanente (grupo) e inmediato (ACL).
#    Así no hace falta cerrar sesión ni volver a entrar.
if [ -n "$REAL_USER" ]; then
  getent group docker >/dev/null 2>&1 || $SUDO groupadd docker >/dev/null 2>&1 || true
  $SUDO usermod -aG docker "$REAL_USER" >/dev/null 2>&1 || true
  if [ -S /var/run/docker.sock ] && command -v setfacl >/dev/null 2>&1; then
    $SUDO setfacl -m "u:${REAL_USER}:rw" /var/run/docker.sock >/dev/null 2>&1 || true
  fi
fi

# 4) Comprobar que el usuario del cliente ya puede hablar con Docker.
if ! su - "$REAL_USER" -c 'docker info >/dev/null 2>&1' >/dev/null 2>&1; then
  log "Docker sigue sin responder para $REAL_USER"
else
  log "Docker accesible para $REAL_USER"
fi

progress 100 "Dependencias instaladas."
log "Dependencias instaladas."
