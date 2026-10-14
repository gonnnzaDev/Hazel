"""Alembic environment for Recop.

Migrations run on the sync driver (psycopg); runtime uses asyncpg.
URL comes from app settings (single source of truth, not `alembic.ini`).
"""

from __future__ import annotations

import sys
from contextlib import suppress
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Repo root so `core` and `apps` are importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.config import get_settings
from core.db.base import Base
from core.registry import app_registry

# Import registered apps so models land in `Base.metadata` for autogenerate.
for _app_name in app_registry.installed:
    # Skip apps without `models.py` yet.
    with suppress(ModuleNotFoundError):
        __import__(f"apps.{_app_name}.models")

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """Connection URL for migrations."""
    return get_settings().sync_database_url


def run_migrations_offline() -> None:
    """Emit SQL without connecting to the DB."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Apply migrations against a live DB."""
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
