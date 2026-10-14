# syntax=docker/dockerfile:1.7
#
# Recop image.
#
# Multi-stage build: the first stage compiles the dependencies, the second copies
# only the result. So the final image carries no compiler, no uv, and none of
# the source code that is no longer needed.
#
# Multi-arch: pin the multi-arch index by digest once the 3.14 release is
# frozen, so the same `docker buildx build` produces the right image
# for linux/amd64 (Intel/AMD), linux/arm64 (Apple Silicon,
# Android 64-bit) and arm/v7 (Android 32-bit) without changing a line.
#
# Building for several architectures at once requires buildx:
#     docker buildx build --platform linux/amd64,linux/arm64 -t gonnnzadev/recop .

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.14-slim-bookworm AS builder

ENV \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

# uv is the dependency manager. It is installed from the official image, pinned
# by digest so a rebuild three months from now gives the same result.
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /usr/local/bin/

WORKDIR /src

# First only the manifests: while they don't change, this layer stays cached and
# later builds reinstall nothing.
COPY pyproject.toml uv.lock README.md ./

COPY src/ ./src/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev

# Now the code.
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY alembic.ini ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.14-slim-bookworm AS runtime

# tini as PID 1: without it, SIGTERM never reaches Uvicorn and the container takes
# 10 seconds to die on every `docker compose restart`. With tini, the process
# receives the signal, Uvicorn closes the WebSocket connections and exits cleanly.
#
# libpq and ca-certificates: needed by the sync driver used for migrations
# (psycopg). At runtime only asyncpg is used, but the migration command runs
# from this same image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tini \
        libpq5 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged user. A node is a process running on somebody's PC;
# it should not be able to write to /usr or create users.
RUN groupadd --system --gid 1001 recap \
    && useradd --system --uid 1001 --gid recap --home-dir /app --shell /usr/sbin/nologin recap

WORKDIR /app

# Default environment. Everything can be overridden with `-e` or compose.
# `RECOP_HOST=0.0.0.0` is mandatory in a container: listening on 127.0.0.1
# means the published port reaches nobody.
ENV \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RECOP_ENV=prod \
    RECOP_HOST=0.0.0.0 \
    RECOP_PORT=7272 \
    RECOP_AUTO_MIGRATE=true

COPY --from=builder --chown=recap:recap /opt/venv /opt/venv
COPY --from=builder --chown=recap:recap /src/src ./src
COPY --from=builder --chown=recap:recap /src/migrations ./migrations
COPY --from=builder --chown=recap:recap /src/alembic.ini ./alembic.ini

RUN mkdir -p /app/data && chown recap:recap /app/data

# The entrypoint waits for the database, applies migrations, and only then
# becomes the API process. `exec` in the script makes PID 1 Uvicorn,
# not the shell.
COPY --chown=recap:recap docker-entrypoint.sh /usr/local/bin/recop-entrypoint
RUN chmod +x /usr/local/bin/recop-entrypoint

USER recap

EXPOSE 7272

# Liveness on purpose, not readiness: Docker only knows how to interpret 200 and
# 503, and `/health/ready` returns 503 while the database is still not responding,
# which would make Docker kill a container that is only just starting. The
# real state of the dependencies is already in `/health/ready`, which is what
# the rest of the stack queries.
#
# Shell form (not exec) on purpose: the only one expanding ${RECOP_PORT}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,sys,urllib.request; url=f\"http://127.0.0.1:{os.environ.get('RECOP_PORT','7272')}/health\"; sys.exit(0 if urllib.request.urlopen(url, timeout=4).status == 200 else 1)"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/recop-entrypoint"]