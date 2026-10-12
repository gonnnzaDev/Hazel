"""Base declarativa compartida por todos los modelos.

Cada app define sus modelos importando `Base` desde acá. Alembic usa
`Base.metadata` para autogenerar migraciones, por lo que todos los modelos deben
estar importados antes de correr una migración (ver `migrations/env.py`).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import ClassVar

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Convención de nombres explícita para que las migraciones de Alembic sean
# deterministas entre diferentes versiones de PostgreSQL.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def _utcnow() -> datetime:
    """Instante actual en UTC. Default de auditoría para todas las tablas."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Base declarativa con convención de nombres y tipos comunes."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map: ClassVar[dict[object, object]] = {
        uuid.UUID: None,  # resuelto por el dialecto asyncpg
    }

    # ─── Helpers de auditoría, presentes en todas las tablas ───────────────────
    #
    # El default es de Python, no solo del servidor. Un `server_default` deja la
    # columna marcada como expirada hasta que se haga un SELECT de refresco, y
    # acceder a ella fuera de contexto async revienta con MissingGreenlet. Con
    # el default en Python el objeto está completo apenas se inserta.
    #
    # El `server_default` se mantiene igual: cubre altas hechas por SQL directo
    # o por una migración.

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        onupdate=_utcnow,
        server_default=func.now(),
        nullable=False,
    )
