#!/bin/sh
# Instala todas las dependencias de Hazel (cliente + nodo) en macOS.
set -eu

log() { printf '[hazel] %s\n' "$*"; }

if ! xcode-select -p >/dev/null 2>&1; then
  log "Instalando Xcode Command Line Tools..."
  xcode-select --install >/dev/null 2>&1 || true
fi

if ! command -v brew >/dev/null 2>&1; then
  log "Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

log "Instalando Node, cmake y Rust..."
brew install node cmake >/dev/null 2>&1 || true
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker Desktop..."
  brew install --cask docker >/dev/null 2>&1 || true
fi
open -a Docker >/dev/null 2>&1 || true

log "Dependencias instaladas."
