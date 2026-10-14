"""Shared types and helpers: record ids and UTC timestamps."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

# Time-ordered opaque id: UUIDv7 gives index locality and creation-order pagination.
RecordId = uuid.UUID


def new_id() -> RecordId:
    """Generate a new domain entity id."""
    return uuid.uuid7()


def utcnow() -> datetime:
    """Current instant, always timezone-aware."""
    return datetime.now(UTC)


def ensure_utc(value: datetime | None) -> datetime | None:
    """Normalize naive datetime to UTC; pass through aware values and None."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
