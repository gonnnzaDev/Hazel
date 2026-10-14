"""Tipos y utilidades compartidos por todas las apps.

Acá vive lo que no pertenece a ningún dominio concreto pero se usa en varios:
ids, timestamps y tipos de Nickname.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

# Un identificador opaco y ordenable en el tiempo: ordenado por UUID nos da
# locality a nivel de índice en PostgreSQL (mucho mejor que un UUID v4 random).
RecordId = uuid.UUID

# UUID v7 (RFC 9562): 48 bits de timestamp en milisegundos, seguidos de datos
# aleatorios. Ordenar por id equivale a ordenar por tiempo de creación, que es
# justo lo que necesitamos para paginar sin un índice extra.
#
# Python 3.14 trae `uuid.uuid7()` en la stdlib, así que se usa directo.


def new_id() -> RecordId:
    """Genera un id nuevo para una entidad del dominio."""
    return uuid.uuid7()


def utcnow() -> datetime:
    """Instante actual, siempre con timezone explícito."""
    return datetime.now(UTC)


def ensure_utc(value: datetime | None) -> datetime | None:
    """Normaliza un datetime naive a UTC.

    PostgreSQL con asyncpg devuelve los `DateTime(timezone=True)` con tz, pero
    esta normalización evita sorpresas al trabajar con valores por defecto.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
