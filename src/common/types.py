"""ID generator w/ uuid7, no autoincrement."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

RecordId = uuid.UUID
def new_id() -> RecordId:
    return uuid.uuid7()

def utcnow() -> datetime:
    return datetime.now(UTC)

def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
