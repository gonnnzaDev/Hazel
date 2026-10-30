"""In-process event bus: fan-out of envelopes to connected sockets of this process.

Cross-process fan-out (node <-> group children) stays out of v1: every process
gets its own bus, and per the architecture decision the socket that publishes
and the sockets that listen live in the same process.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from common.types import RecordId

logger = logging.getLogger(__name__)


def envelope(
    event_type: str,
    *,
    server_id: RecordId,
    channel_id: RecordId | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message: dict[str, Any] = {
        "type": event_type,
        "server_id": str(server_id),
        "data": data or {},
    }
    if channel_id is not None:
        message["channel_id"] = str(channel_id)
    return message


@dataclass(slots=True)
class TypingWindow:
    """Fixed-window rate limiter state for typing events of one socket."""

    start: float = 0.0
    count: int = 0

    def admit(self, now: float, *, limit: int, window: float = 60.0) -> bool:
        if now - self.start >= window:
            self.start = now
            self.count = 0
        if self.count >= limit:
            return False
        self.count += 1
        return True


@dataclass(slots=True)
class Subscription:
    """Its own outbound queue: bounded, and slow consumers are closed."""

    id: uuid.UUID
    server_id: RecordId
    member_id: RecordId
    nickname: str
    display_name: str | None
    queue: asyncio.Queue[dict[str, Any]]

    channels: set[RecordId] = field(default_factory=set)
    closed: bool = False


class EventBus:
    def __init__(self, *, queue_size: int = 128) -> None:
        self._queue_size = queue_size
        self._subs: dict[uuid.UUID, Subscription] = {}
        self._sockets_by_member: dict[tuple[RecordId, RecordId], int] = {}

    def configure(self, *, queue_size: int) -> None:
        if not self._subs:
            self._queue_size = queue_size

    def subscribe(
        self,
        *,
        server_id: RecordId,
        member_id: RecordId,
        nickname: str,
        display_name: str | None,
    ) -> tuple[Subscription, bool]:
        sub = Subscription(
            id=uuid.uuid4(),
            server_id=server_id,
            member_id=member_id,
            nickname=nickname,
            display_name=display_name,
            queue=asyncio.Queue(maxsize=self._queue_size),
        )
        self._subs[sub.id] = sub
        key = (sub.server_id, sub.member_id)
        self._sockets_by_member[key] = self._sockets_by_member.get(key, 0) + 1
        return sub, self._sockets_by_member[key] == 1

    def unsubscribe(self, sub: Subscription) -> bool:
        """Remove a subscription. True when it was the member's last socket."""
        self._subs.pop(sub.id, None)
        key = (sub.server_id, sub.member_id)
        remaining = self._sockets_by_member.get(key, 0) - 1
        if remaining > 0:
            self._sockets_by_member[key] = remaining
            return False
        self._sockets_by_member.pop(key, None)
        return True

    def subscribe_channel(self, sub: Subscription, channel_id: RecordId) -> None:
        sub.channels.add(channel_id)

    def unsubscribe_channel(self, sub: Subscription, channel_id: RecordId) -> None:
        sub.channels.discard(channel_id)

    def publish(
        self,
        *,
        server_id: RecordId,
        channel_id: RecordId | None = None,
        event: dict[str, Any],
    ) -> None:
        targets = [
            sub
            for sub in self._subs.values()
            if sub.server_id == server_id and (channel_id is None or channel_id in sub.channels)
        ]
        for sub in targets:
            self._enqueue(sub, event)

    def _enqueue(self, sub: Subscription, payload: dict[str, Any]) -> None:
        try:
            sub.queue.put_nowait(payload)
        except asyncio.QueueFull:
            logger.warning(
                "socket sub=%s member=%s is too slow; closing it",
                sub.id,
                sub.member_id,
            )
            sub.closed = True
            self._subs.pop(sub.id, None)


bus = EventBus()


def enqueue_direct(sub: Subscription, payload: dict[str, Any]) -> None:
    """Send straight to one socket's queue without the fan-out rules."""
    try:
        sub.queue.put_nowait(payload)
    except asyncio.QueueFull:
        sub.closed = True
