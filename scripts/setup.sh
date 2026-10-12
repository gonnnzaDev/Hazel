#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recop — instalación
#
#     ./scripts/setup.sh
#
# Funciona en Linux, macOS y Android (Termux). Para Windows, setup.ps1.
#
# Qué hace, en orden:
#   1. Detecta la plataforma y chequea que falte lo mínimo
#   2. Instala uv si no está (uv trae su propio Python, así que no hace falta
#      tener Python instalado)
#   3. Instala las dependencias exactas que define uv.lock
#   4. Crea el .env con un secreto generado
#   5. Levanta PostgreSQL y Kafka con Docker, si hay Docker
#
# Es idempotente: correrlo dos veces no rompe nada.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ─── Presentación ─────────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf '\n%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
info()  { printf '    %s%s%s\n' "$DIM" "$*" "$RESET"; }
ok()    { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()   { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

# ─── 1. Plataforma ────────────────────────────────────────────────────────────

step "Detectando la plataforma"

UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"

# Termux define $PREFIX; además el kernel se identifica como Android.
IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [ -n "${PREFIX:-}" ] || [ "$(uname -o 2>/dev/null || true)" = "Android" ]; then
    IS_TERMUX=1
fi

case "$UNAME_S" in
    Linux)   PLATFORM="linux" ;;
    Darwin)  PLATFORM="macos" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)       PLATFORM="desconocida ($UNAME_S)" ;;
esac

ok "$PLATFORM / $UNAME_M"
if [ "$IS_TERMUX" -eq 1 ]; then
    ok "Android (Termux)"
fi

# ─── 2. Prerrequisitos ────────────────────────────────────────────────────────

step "Chequeando lo mínimo"

command -v git >/dev/null 2>&1 || die "necesitás git. Instalalo y volvé a correr este script."

if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    DOWNLOADER=""
    warn "no encontré curl ni wget. Voy a necesitar uno de los dos."
fi
info "git ✓  ${DOWNLOADER:-sin downloader}"

# ─── 3. uv ────────────────────────────────────────────────────────────────────

install_uv() {
    info "instalando uv..."

    if [ -n "$DOWNLOADER" ]; then
        if [ "$DOWNLOADER" = "curl" ]; then
            curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
        else
            wget -qO- https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
        fi
    else
        python3 -m pip install --user uv >/dev/null 2>&1 || return 1
    fi

    # uv se instala en ~/.local/bin, que puede no estar en el PATH todavía.
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) export PATH="$HOME/.local/bin:$PATH" ;;
    esac
    command -v uv >/dev/null 2>&1
}

step "Instalando uv (el gestor de dependencias)"
if command -v uv >/dev/null 2>&1; then
    ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"
else
    install_uv || die "no pude instalar uv. Instalalo a mano: https://docs.astral.sh/uv/getting-started/installation/"
    ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"
fi

info "uv trae su propio Python, así que no hace falta que tengas Python instalado."

# ─── 4. Dependencias ──────────────────────────────────────────────────────────

step "Instalando las dependencias"

# uv sync usa uv.lock: es una lista exacta de versiones. Todos los que corran
# este script instalan lo mismo, sin importar cuándo lo corren.
if uv sync --locked --no-dev 2>&1 | sed 's/^/    /'; then
    ok "dependencias instaladas (exactas, desde uv.lock)"
else
    die "falló la instalación de dependencias. Revisá el error de arriba."
fi

if uv sync --locked 2>&1 | sed 's/^/    /'; then
    ok "herramientas de desarrollo instaladas"
fi

# ─── 5. Configuración ─────────────────────────────────────────────────────────

step "Preparando la configuración"

if [ -f .env ]; then
    ok ".env ya existe, no lo toco"
else
    cp .env.example .env

    # El compose falla a propósito si RECOP_SECRET_KEY no está. Generamos una de
    # verdad para que el primer arranque funcione sin pasos extra.
    SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || python -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || head -c 32 /dev/urandom | base64)"

    if command -v uv >/dev/null 2>&1; then
        SECRET="$(uv run python -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || echo "$SECRET")"
    fi

    # sed -i no es portable entre GNU y BSD (macOS), así que se reescribe el
    # archivo entero en vez de editarlo en el lugar.
    awk -v secret="$SECRET" '
        /^RECOP_SECRET_KEY=/ { print "RECOP_SECRET_KEY=" secret; next }
        { print }
    ' .env.example > .env

    chmod 600 .env
    ok ".env creado con un secreto generado"
fi

# ─── 6. Docker ────────────────────────────────────────────────────────────────

step "Buscando Docker"

HAVE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    HAVE_DOCKER=1
    ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
elif command -v docker >/dev/null 2>&1; then
    warn "docker está instalado pero el daemon no responde."
    warn "Si es Linux: agregate al grupo docker -> sudo usermod -aG docker \$USER"
elif [ "$IS_TERMUX" -eq 1 ]; then
    warn "Docker en Android requiere Termux con el paquete docker y permisos extra."
else
    warn "no encontré Docker."
fi

if [ "$HAVE_DOCKER" -eq 1 ]; then
    step "Levantando PostgreSQL y Kafka"
    if docker compose -f docker-compose.dev.yml up -d 2>&1 | sed 's/^/    /'; then
        info "esperando a que PostgreSQL responda..."
        for _ in $(seq 1 30); do
            if docker compose -f docker-compose.dev.yml exec -T postgres \
                pg_isready -U "${POSTGRES_USER:-recop}" >/dev/null 2>&1; then
                break
            fi
            sleep 1
        done
        ok "PostgreSQL y Kafka levantados"
    else
        warn "no pude levantar los servicios. Los dejo para que los mires vos."
    fi

    step "Aplicando migraciones"
    if uv run alembic upgrade head 2>&1 | sed 's/^/    /'; then
        ok "base de datos lista"
    else
        warn "fallaron las migraciones. Corré 'make migrate' cuando la base esté arriba."
    fi
fi

# ─── 7. Listo ─────────────────────────────────────────────────────────────────

PORT="$(awk -F= '/^RECOP_PORT=/ {print $2}' .env | head -1)"
PORT="${PORT:-7272}"

cat <<EOF

${GREEN}${BOLD}Listo.${RESET}

  ${BOLD}Arrancar el nodo${RESET}
    uv run python -m core

  Y después, en otra terminal:

    ${DIM}curl localhost:${PORT}/docs${RESET}        la API documentada
    ${DIM}curl localhost:${PORT}/api/v1/node${RESET}   la dirección para compartir

  ${BOLD}Sin Docker${RESET}: apuntá RECOP_DATABASE_URL y RECOP_KAFKA_BOOTSTRAP_SERVERS
  en el .env a unas bases de datos que ya tengas, y corré las migraciones.

  ${BOLD}Los cuatro estados de un servidor${RESET}
    Apagado o caído  → puerto cerrado, datos intactos
    Encendido        → puerto abierto, datos intactos
    Eliminado        → puerto cerrado, datos borrados

  ${BOLD}Ayuda${RESET}
    ./scripts/recop.sh help      lista los comandos
    make help                     lo mismo, si tenés make

EOF