#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recop — installation
#
#     ./scripts/setup.sh
#
# Works on Linux, macOS, and Android (Termux). For Windows, use setup.ps1.
#
# What it does, in order:
#   1. Detects the platform and checks the bare minimum
#   2. Installs uv if missing (uv brings its own Python, so you don't need
#      Python installed)
#   3. Installs the exact dependencies pinned in uv.lock
#   4. Creates the .env with a generated secret
#   5. Starts PostgreSQL and Kafka with Docker, if Docker is available
#
# It is idempotent: running it twice breaks nothing.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ─── Presentation ─────────────────────────────────────────────────────────────

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

# ─── 1. Platform ────────────────────────────────────────────────────────────

step "Detecting the platform"

UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"

# Termux defines $PREFIX; also the kernel identifies itself as Android.
IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [ -n "${PREFIX:-}" ] || [ "$(uname -o 2>/dev/null || true)" = "Android" ]; then
    IS_TERMUX=1
fi

case "$UNAME_S" in
    Linux)   PLATFORM="linux" ;;
    Darwin)  PLATFORM="macos" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)       PLATFORM="unknown ($UNAME_S)" ;;
esac

ok "$PLATFORM / $UNAME_M"
if [ "$IS_TERMUX" -eq 1 ]; then
    ok "Android (Termux)"
fi

# ─── 2. Prerequisites ────────────────────────────────────────────────────────

step "Checking the bare minimum"

command -v git >/dev/null 2>&1 || die "you need git. Install it and run this script again."

if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    DOWNLOADER=""
    warn "found neither curl nor wget. I will need one of the two."
fi
info "git ✓  ${DOWNLOADER:-no downloader}"

# ─── 3. uv ────────────────────────────────────────────────────────────────────

install_uv() {
    info "installing uv..."

    if [ -n "$DOWNLOADER" ]; then
        if [ "$DOWNLOADER" = "curl" ]; then
            curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
        else
            wget -qO- https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
        fi
    else
        python3 -m pip install --user uv >/dev/null 2>&1 || return 1
    fi

    # uv installs into ~/.local/bin, which may not be on PATH yet.
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) export PATH="$HOME/.local/bin:$PATH" ;;
    esac
    command -v uv >/dev/null 2>&1
}

step "Installing uv (the dependency manager)"
if command -v uv >/dev/null 2>&1; then
    ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"
else
    install_uv || die "could not install uv. Install it manually: https://docs.astral.sh/uv/getting-started/installation/"
    ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"
fi

info "uv brings its own Python, so you don't need Python installed."

# ─── 4. Dependencies ──────────────────────────────────────────────────────────

step "Installing dependencies"

# uv sync uses uv.lock: an exact list of versions. Everyone running
# this script installs the same thing, no matter when they run it.
if uv sync --locked --no-dev 2>&1 | sed 's/^/    /'; then
    ok "dependencies installed (exact, from uv.lock)"
else
    die "dependency installation failed. Check the error above."
fi

if uv sync --locked 2>&1 | sed 's/^/    /'; then
    ok "dev tools installed"
fi

# ─── 5. Configuration ─────────────────────────────────────────────────────────

step "Preparing configuration"

if [ -f .env ]; then
    ok ".env already exists, leaving it alone"
else
    # Compose fails on purpose when RECOP_SECRET_KEY is missing. We generate a
    # real one so the first start works with no extra steps.
    SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || python -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || head -c 32 /dev/urandom | base64)"

    if command -v uv >/dev/null 2>&1; then
        SECRET="$(uv run python -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || echo "$SECRET")"
    fi

    # Defaults mirroring src/core/config.py: the only thing that must be unique
    # per install is the secret.
    cat > .env <<EOF
# Recop — local configuration (generated by setup.sh; NEVER commit).
# Environment: local | test | prod
RECOP_ENV=local
RECOP_DEBUG=true
# Secret for signing sessions/tokens.
RECOP_SECRET_KEY=$SECRET

# Only for docker compose: the containerized node does not use them, only compose does.
RECOP_PUBLISH_HOST=0.0.0.0
RECOP_PUBLISH_PORT=7272

POSTGRES_USER=recop
POSTGRES_PASSWORD=recop
POSTGRES_DB=recop
POSTGRES_PORT=5432

KAFKA_EXTERNAL_PORT=9092

RECOP_AUTO_MIGRATE=true

RECOP_HOST=0.0.0.0
RECOP_PORT=7272
RECOP_ROOT_PATH=
RECOP_CORS_ORIGINS=*

RECOP_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop
RECOP_DB_POOL_SIZE=10
RECOP_DB_MAX_OVERFLOW=20
RECOP_DB_ECHO=false

RECOP_KAFKA_BOOTSTRAP_SERVERS=localhost:9092
RECOP_KAFKA_TOPIC_PREFIX=recop
RECOP_KAFKA_CLIENT_ID=
RECOP_KAFKA_MAX_POLL_RECORDS=500

RECOP_RATE_LIMIT_MESSAGES_PER_MINUTE=20
RECOP_MAX_MESSAGE_BYTES=4000
EOF

    chmod 600 .env
    ok ".env created with a generated secret"
fi

# ─── 6. Docker ────────────────────────────────────────────────────────────────

step "Looking for Docker"

HAVE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    HAVE_DOCKER=1
    ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
elif command -v docker >/dev/null 2>&1; then
    warn "docker is installed but the daemon is not responding."
    warn "On Linux: add yourself to the docker group -> sudo usermod -aG docker \$USER"
elif [ "$IS_TERMUX" -eq 1 ]; then
    warn "Docker on Android requires Termux with the docker package and extra permissions."
else
    warn "no Docker found."
fi

if [ "$HAVE_DOCKER" -eq 1 ]; then
    step "Starting PostgreSQL and Kafka"
    if docker compose -f docker-compose.dev.yml up -d 2>&1 | sed 's/^/    /'; then
        info "waiting for PostgreSQL to respond..."
        for _ in $(seq 1 30); do
            if docker compose -f docker-compose.dev.yml exec -T postgres \
                pg_isready -U "${POSTGRES_USER:-recop}" >/dev/null 2>&1; then
                break
            fi
            sleep 1
        done
        ok "PostgreSQL and Kafka are up"
    else
        warn "could not start the services. Leaving them for you to look at."
    fi

    step "Applying migrations"
    if uv run alembic upgrade head 2>&1 | sed 's/^/    /'; then
        ok "database ready"
    else
        warn "migrations failed. Run 'make migrate' once the database is up."
    fi
fi

# ─── 7. Listo ─────────────────────────────────────────────────────────────────

PORT="$(awk -F= '/^RECOP_PORT=/ {print $2}' .env | head -1)"
PORT="${PORT:-7272}"

cat <<EOF

${GREEN}${BOLD}Done.${RESET}

  ${BOLD}Start the node${RESET}
    uv run python -m core

  Then, in another terminal:

    ${DIM}curl localhost:${PORT}/docs${RESET}        the documented API
    ${DIM}curl localhost:${PORT}/api/v1/node${RESET}   the address to share

  ${BOLD}Without Docker${RESET}: point RECOP_DATABASE_URL and RECOP_KAFKA_BOOTSTRAP_SERVERS
  in the .env to databases you already have, and run the migrations.

  ${BOLD}The four states of a server${RESET}
    Off or down  → port closed, data intact
    On           → port open, data intact
    Deleted      → port closed, data deleted

  ${BOLD}Help${RESET}
    ./scripts/recop.sh help      list the commands
    make help                    same thing, if you have make

EOF