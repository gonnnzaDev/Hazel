"""Tipos y utilidades compartidos por todas las apps.

Acá vive lo que no pertenece a ningún dominio concreto pero se usa en varios:
ids, timestamps y tipos de Nickname.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

# Un identificador opaco y ordenable en el tiempo: ordenado por UUID nos da
# locality a nivel de índice en PostgreSQL (mucho mejor que un UUID v4 random).
RecordId = uuid.UUID

# UUID v7 (RFC 9562): 48 bits de timestamp en milisegundos, seguidos de datos
# aleatorios. Ordenar por id equivale a ordenar por tiempo de creación, que es
# justo lo que necesitamos para paginar sin un índice extra.
#
# `uuid.uuid7()` todavía no está en Python 3.13 (llega en 3.14), así que se
# implementa acá. Cuando el proyecto migre a 3.14, esto se puede borrar y usar
# el de la stdlib.

# Bits de timestamp: unix_ts_ms en milisegundos.
_TIMESTAMP_MASK = (1 << 48) - 1


def _uuid7() -> uuid.UUID:
    """Genera un UUID v7 conforme a RFC 9562.

    Layout de 128 bits:

        | 48 bits timestamp | 4 version | 12 rand | 6 rand | 62 rand |

    `uuid.UUID(version=...)` de la stdlib solo acepta versiones 1 a 5, así que
    los bits de versión y variante se escriben a mano.
    """
    timestamp_ms = int(utcnow().timestamp() * 1000) & _TIMESTAMP_MASK

    rand_a = secrets.randbits(12)  # bits 15..0
    rand_b = secrets.randbits(62)  # bits 61..16

    value = (timestamp_ms << 80) | (rand_b << 16) | rand_a

    # version = 7 (bits 79..76)
    value = (value & ~(0xF << 76)) | (0x7 << 76)
    # variant = RFC 4122 (bits 63..62)
    value = (value & ~(0x3 << 62)) | (0b10 << 62)

    return uuid.UUID(int=value)


def new_id() -> RecordId:
    """Genera un id nuevo para una entidad del dominio."""
    return _uuid7()


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
