"""Shared declarative base for all models.

All models must be imported before migrations so Alembic sees them (see env.py).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import ClassVar

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Explicit naming so Alembic migrations are deterministic across PG versions.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def _utcnow() -> datetime:
    """Current UTC time; audit default for all tables."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Declarative base with naming convention and common types."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map: ClassVar[dict[object, object]] = {
        uuid.UUID: None,  # resolved by the asyncpg dialect
    }

    # ─── Audit helpers, present on all tables ────────────────────────────────
    #
    # Python-side default keeps objects complete without refresh (avoids MissingGreenlet);
    # server_default covers raw SQL and migrations.

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
