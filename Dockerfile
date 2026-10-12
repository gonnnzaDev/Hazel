# syntax=docker/dockerfile:1.7
#
# Imagen de Recop.
#
# Es un multi-stage: la primera etapa compila las dependencias, la segunda copia
# solo el resultado. Así la imagen final no lleva el compilador, ni uv, ni el
# código fuente que ya no hace falta.
#
# Multi-arquitectura: la imagen base está fijada por digest, así que el mismo
# `docker buildx build` produce la imagen correcta para linux/amd64 (Intel/AMD),
# linux/arm64 (Apple Silicon, Android 64-bit) y arm/v7 (Android 32-bit) sin
# cambiar una línea. El digest es el del índice multi-arquitectura, no el de una
# plataforma: por eso compila para todas.
#
# Para construir para varias arquitecturas a la vez hace falta buildx:
#     docker buildx build --platform linux/amd64,linux/arm64 -t gonnnzadev/recop .

# ─────────────────────────────────────────────────────────────────────────────
# Etapa 1: builder
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641 AS builder

ENV \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

# uv es el gestor de dependencias. Se instala desde la imagen oficial, fijada por
# digest para que una rebuild dentro de tres meses dé el mismo resultado.
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /usr/local/bin/

WORKDIR /src

# Primero solo los manifiestos: mientras no cambien, esta capa se cachea y las
# builds following no reinstalan nada.
COPY pyproject.toml uv.lock README.md ./
COPY apps/__init__.py ./apps/__init__.py
COPY core/__init__.py ./core/__init__.py

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev

# Ahora sí, el código.
COPY apps/ ./apps/
COPY core/ ./core/
COPY migrations/ ./migrations/
COPY alembic.ini ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


# ─────────────────────────────────────────────────────────────────────────────
# Etapa 2: runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641 AS runtime

# tini como PID 1: sin él, SIGTERM no llega a Uvicorn y el contenedor tarda
# 10 segundos en morir en cada `docker compose restart`. Con tini, el proceso
# recibe la señal, Uvicorn cierra las conexiones WebSocket y sale limpio.
#
# libpq y ca-certificates: los necesita el driver síncrono de las migraciones
# (psycopg). En runtime solo se usa asyncpg, pero el comando de migración se
# ejecuta desde esta misma imagen.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tini \
        libpq5 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios. Un nodo es un proceso que corre en la PC de alguien;
# no debería poder escribir en /usr ni crear usuarios.
RUN groupadd --system --gid 1001 recap \
    && useradd --system --uid 1001 --gid recap --home-dir /app --shell /usr/sbin/nologin recap

WORKDIR /app

# Entorno por defecto. Todo se puede sobreescribir con `-e` o compose.
# `RECOP_HOST=0.0.0.0` es obligatorio en un container: si escucha en 127.0.0.1
# el puerto publicado no llega a nadie.
ENV \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RECOP_ENV=prod \
    RECOP_HOST=0.0.0.0 \
    RECOP_PORT=7272 \
    RECOP_AUTO_MIGRATE=true

COPY --from=builder --chown=recap:recap /opt/venv /opt/venv
COPY --from=builder --chown=recap:recap /src/apps ./apps
COPY --from=builder --chown=recap:recap /src/core ./core
COPY --from=builder --chown=recap:recap /src/migrations ./migrations
COPY --from=builder --chown=recap:recap /src/alembic.ini ./alembic.ini

RUN mkdir -p /app/data && chown recap:recap /app/data

# El entrypoint espera la base de datos, aplica migraciones y recién ahí se
# convierte en el proceso de la API. `exec` en el script hace que PID 1 sea
# Uvicorn y no el shell.
COPY --chown=recap:recap docker-entrypoint.sh /usr/local/bin/recop-entrypoint
RUN chmod +x /usr/local/bin/recop-entrypoint

USER recap

EXPOSE 7272

# Liveness a propósito, no readiness: Docker solo sabe interpretar 200 y 503, y
# `/health/ready` devuelve 503 mientras la base de datos todavía no responde,
# lo que haría que Docker mate un contenedor que solo está arrancando. El
# estado real de las dependencias ya está en `/health/ready`, que es lo que
# consulta el resto del stack.
#
# Forma de shell (no exec) a propósito: es la única que expande ${RECOP_PORT}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,sys,urllib.request; url=f\"http://127.0.0.1:{os.environ.get('RECOP_PORT','7272')}/health\"; sys.exit(0 if urllib.request.urlopen(url, timeout=4).status == 200 else 1)"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/recop-entrypoint"]