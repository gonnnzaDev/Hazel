"""Lectura y generación de ``.env`` para el composer.

Este módulo es deliberadamente pequeño y usa solo ``stdlib``: el composer no
debe depender de ``python-dotenv`` ni de nada de lo que antes era la app.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
RUST_DIR = ROOT / "rust"
BINARY = RUST_DIR / "target" / "release" / "hazel"

# Valores por defecto. Coinciden con rust/src/config.rs y con los que antes
# generaba scripts/setup.sh. Solo el secreto y el token cambian por instalación.
TEMPLATE = """\
# Hazel — configuración local (generada por `python -m composer setup`).
# NUNCA commitear este archivo.
HAZEL_ENV=local
HAZEL_DEBUG=true
HAZEL_SECRET_KEY={secret}
HAZEL_ADMIN_TOKEN={admin_token}

# Red / proceso
HAZEL_HOST=0.0.0.0
HAZEL_PORT=7272
HAZEL_GROUP_PORT_END=7400
HAZEL_ROOT_PATH=
HAZEL_CORS_ORIGINS=*

# Base de datos. El compose interno usa `postgres` como host; para correr el
# nodo en la máquina, el composer reescribe el host a `localhost`.
POSTGRES_USER=hazel
POSTGRES_PASSWORD=hazel
POSTGRES_DB=hazel
POSTGRES_PORT=5432
HAZEL_DATABASE_URL=postgresql+asyncpg://{user}:{password}@localhost:5432/{db}
HAZEL_DB_POOL_SIZE=10
HAZEL_DB_MAX_OVERFLOW=20
HAZEL_DB_ECHO=false

# Kafka (modo KRaft, sin ZooKeeper)
KAFKA_EXTERNAL_PORT=9092
HAZEL_KAFKA_BOOTSTRAP_SERVERS=localhost:9092
HAZEL_KAFKA_TOPIC_PREFIX=hazel
HAZEL_KAFKA_CLIENT_ID=
HAZEL_KAFKA_MAX_POLL_RECORDS=500
HAZEL_KAFKA_FANOUT_ENABLED=true

# Límites
HAZEL_RATE_LIMIT_MESSAGES_PER_MINUTE=20
HAZEL_MAX_MESSAGE_BYTES=4000
HAZEL_MAX_ATTACHMENT_BYTES=25000000
HAZEL_STORAGE_ROOT={storage}
HAZEL_BACKUP_RETENTION_DAYS=3

# Publicación del contenedor del nodo
HAZEL_PUBLISH_HOST=0.0.0.0
HAZEL_PUBLISH_PORT=7272
"""


def create_env(force: bool = False) -> bool:
    """Escribe un ``.env`` con secretos nuevos. Devuelve False si ya existía."""
    if ENV_FILE.exists() and not force:
        return False
    values = {
        "secret": secrets.token_urlsafe(32),
        "admin_token": secrets.token_urlsafe(32),
        "user": "hazel",
        "password": "hazel",
        "db": "hazel",
        "storage": str(ROOT / "data"),
    }
    ENV_FILE.write_text(TEMPLATE.format(**values), encoding="utf-8")
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass
    return True


def read_env() -> dict[str, str]:
    """Carga ``.env`` sin sobrescribir variables del entorno real."""
    values: dict[str, str] = {}
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    values.update(os.environ)
    return values


def get(values: dict[str, str], key: str, default: str = "") -> str:
    return str(values.get(key, default))


def database_url(values: dict[str, str], host: str = "localhost") -> str:
    """URL de PostgreSQL con el host que corresponda.

    sqlx/libpq no entiende ``+asyncpg``: se lo quita, igual que
    ``Settings::sync_database_url()`` en Rust.
    """
    user = get(values, "POSTGRES_USER", "hazel")
    password = get(values, "POSTGRES_PASSWORD", "hazel")
    db = get(values, "POSTGRES_DB", "hazel")
    return f"postgresql://{user}:{password}@{host}:5432/{db}"


def rust_env(values: dict[str, str], host: str = "localhost", port: int | None = None) -> dict[str, str]:
    """Variables que espera el binario Rust (todas con prefijo HAZEL_)."""
    result = {key: value for key, value in values.items() if key.startswith("HAZEL_")}
    result["HAZEL_DATABASE_URL"] = database_url(values, host)
    if port is not None:
        result["HAZEL_PORT"] = str(port)
    return result
