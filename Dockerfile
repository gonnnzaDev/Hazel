# syntax=docker/dockerfile:1.7
#
# Hazel — imagen del nodo Rust.
#
# La construye `python -m composer up full`; el composer es el único orquestador
# (no hay docker-compose). Dos etapas: compila con Rust, ejecuta sin toolchain.

# ─── Builder ─────────────────────────────────────────────────────────────────
FROM rust:1.100-bookworm AS builder

# cmake, ninja, perl y pkg-config los necesita rdkafka (cmake-build).
RUN apt-get update && apt-get install -y --no-install-recommends \
        cmake ninja-build perl pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY rust/Cargo.toml rust/Cargo.lock ./
COPY rust/src/ ./src/

RUN --mount=type=cache,target=/opt/cargo/registry \
    --mount=type=cache,target=/opt/cargo/git \
    CARGO_HOME=/opt/cargo cargo build --release --locked

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# libpq5 + postgresql-client: el nodo usa pg_dump/pg_restore para backup/restore.
# curl: healthcheck. libssl3/libzstd1: librdkafka y sqlx.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl libpq5 libssl3 libzstd1 postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 hazel \
    && useradd --system --uid 1001 --gid hazel --home-dir /app --shell /usr/sbin/nologin hazel

WORKDIR /app

COPY --from=builder --chown=hazel:hazel /src/target/release/hazel /usr/local/bin/hazel

RUN mkdir -p /app/data && chown hazel:hazel /app/data

USER hazel

ENV HAZEL_ENV=prod \
    HAZEL_HOST=0.0.0.0 \
    HAZEL_PORT=7272 \
    HAZEL_STORAGE_ROOT=/data/hazel \
    RUST_LOG=info

EXPOSE 7272

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${HAZEL_PORT}/health" >/dev/null || exit 1

# El entrypoint de Python desapareció: el nodo es un binario y es PID 1.
# El composer se encarga de esperar a la BD y de aplicar las migraciones.
ENTRYPOINT ["/usr/local/bin/hazel"]
CMD ["node"]
