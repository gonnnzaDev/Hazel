"""Entorno de Alembic para Recop.

Las migraciones corren con el driver síncrono (psycopg) porque Alembic tiene
soporte async limitado; la app en runtime usa asyncpg.

La URL no está en `alembic.ini`: se lee de la configuración de la app para que
exista una sola fuente de verdad.
"""

from __future__ import annotations

import sys
from contextlib import suppress
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# El directorio raíz del repo, para que `core` y `apps` sean importables.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.config import get_settings
from core.db.base import Base
from core.registry import app_registry

# Importar cada app registrada garantiza que todos los modelos estén en
# `Base.metadata` antes de autogenerar. El orden lo fija `INSTALLED_APPS`.
for _app_name in app_registry.installed:
    # Una app sin modelos todavía no expone `models.py`. Se va agregando con el tiempo.
    with suppress(ModuleNotFoundError):
        __import__(f"apps.{_app_name}.models")

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """URL de conexión para migraciones."""
    return get_settings().sync_database_url


def run_migrations_offline() -> None:
    """Genera SQL sin conectarse a la base."""
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
    """Aplica las migraciones contra una base real."""
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
