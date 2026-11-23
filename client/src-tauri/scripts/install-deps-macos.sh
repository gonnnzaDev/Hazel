#!/bin/sh
# Instala todas las dependencias de Hazel (cliente + nodo) en macOS.
set -eu

log() { printf '[hazel] %s\n' "$*"; }
progress() { printf '@@HAZEL_PROGRESS@@%s|%s\n' "$1" "$2"; }

progress 8 "Comprobando Xcode..."
if ! xcode-select -p >/dev/null 2>&1; then
  log "Instalando Xcode Command Line Tools..."
  xcode-select --install >/dev/null 2>&1 || true
fi

if ! command -v brew >/dev/null 2>&1; then
  log "Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

progress 30 "Instalando Node y cmake..."
log "Instalando Node, cmake y Rust..."
brew install node cmake >/dev/null 2>&1 || true
progress 55 "Instalando Rust..."
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

progress 80 "Instalando Docker Desktop..."
if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker Desktop..."
  brew install --cask docker >/dev/null 2>&1 || true
fi
open -a Docker >/dev/null 2>&1 || true

progress 100 "Dependencias instaladas."
log "Dependencias instaladas."
