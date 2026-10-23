from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from events.bus import Event, build_event, event_bus

logger = logging.getLogger(__name__)

PENDING_EVENTS_KEY = "hazel.pending_events"


def queue_event(
    session: AsyncSession,
    *,
    event_type: str,
    server_id: str,
    data: dict[str, Any],
    channel_id: str | None = None,
) -> None:
    event = build_event(
        event_type,
        server_id,
        data,
        channel_id=channel_id,
    )
    pending: list[Event] = session.info.setdefault(PENDING_EVENTS_KEY, [])
    pending.append(event)


async def dispatch_pending_events(session: AsyncSession) -> None:
    pending: list[Event] = session.info.pop(PENDING_EVENTS_KEY, [])
    for event in pending:
        try:
            await event_bus.publish(event)
        except Exception:
            logger.exception("could not publish event type=%s", event["type"])
