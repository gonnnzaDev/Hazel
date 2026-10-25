"""Outbox: application events ride the request transaction and fan out after commit.

The bus is in-process per decision; publishing stays behind this seam so a
Kafka or PostgreSQL transport can replace it without touching views. Delivery
is at-least-once: an unclean shutdown can replay an event that was fanned out
but not yet deleted.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.types import RecordId, new_id
from events.bus import bus, envelope
from events.model import OutboxEvent

logger = logging.getLogger(__name__)

DRAIN_BATCH = 200


async def queue_event(
    session: AsyncSession,
    event_type: str,
    *,
    server_id: RecordId,
    channel_id: RecordId | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    """Insert the event in the same transaction as the change itself."""
    session.add(
        OutboxEvent(
            id=new_id(),
            event_type=event_type,
            server_id=server_id,
            channel_id=channel_id,
            data=data or {},
        )
    )


async def drain_pending(session: AsyncSession) -> None:
    """Fan out committed events to this process' bus, then delete the rows."""
    rows = list(
        (
            await session.execute(
                select(OutboxEvent)
                .order_by(OutboxEvent.id)
                .limit(DRAIN_BATCH)
                .with_for_update(skip_locked=True)
            )
        ).scalars()
    )
    if not rows:
        return

    for row in rows:
        bus.publish(
            server_id=row.server_id,
            channel_id=row.channel_id,
            event=envelope(
                row.event_type,
                server_id=row.server_id,
                channel_id=row.channel_id,
                data=dict(row.data or {}),
            ),
        )

    await session.execute(delete(OutboxEvent).where(OutboxEvent.id.in_([row.id for row in rows])))
    await session.flush()


async def publish_pending(session: AsyncSession) -> None:
    """Post-commit hook: fan out this process' queued events, keeping errors soft."""
    try:
        await drain_pending(session)
        await session.commit()
    except Exception:
        logger.exception("outbox drain failed; rows stay queued for the next drain")
        await session.rollback()
