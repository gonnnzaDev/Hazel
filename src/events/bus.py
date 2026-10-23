from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any, NotRequired, TypedDict


class Event(TypedDict):
    type: str
    server_id: str
    data: dict[str, Any]
    channel_id: NotRequired[str]


def build_event(
    event_type: str,
    server_id: str,
    data: dict[str, Any],
    *,
    channel_id: str | None = None,
) -> Event:
    event: Event = {"type": event_type, "server_id": server_id, "data": data}
    if channel_id is not None:
        event["channel_id"] = channel_id
    return event


MAX_QUEUE_SIZE = 256


@dataclass(eq=False, slots=True)
class Subscription:
    server_id: str
    member_id: str
    nickname: str
    display_name: str
    channels: set[str] = field(default_factory=set)
    queue: asyncio.Queue[Event] = field(
        default_factory=lambda: asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
    )
    overflowed: bool = False

    def offer(self, event: Event) -> None:
        channel_id = event.get("channel_id")
        if channel_id is not None and channel_id not in self.channels:
            return

        if self.queue.full():
            with suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
            self.overflowed = True

        with suppress(asyncio.QueueFull):
            self.queue.put_nowait(event)


class EventBus:
    def __init__(self) -> None:
        self._subscriptions: dict[str, set[Subscription]] = {}
        self._member_connections: dict[tuple[str, str], int] = {}

    def subscribe(
        self,
        *,
        server_id: str,
        member_id: str,
        nickname: str,
        display_name: str,
    ) -> tuple[Subscription, bool]:
        subscription = Subscription(
            server_id=server_id,
            member_id=member_id,
            nickname=nickname,
            display_name=display_name,
        )
        self._subscriptions.setdefault(server_id, set()).add(subscription)

        key = (server_id, member_id)
        count = self._member_connections.get(key, 0)
        self._member_connections[key] = count + 1
        return subscription, count == 0

    def unsubscribe(self, subscription: Subscription) -> bool:
        subscriptions = self._subscriptions.get(subscription.server_id)
        if subscriptions is not None:
            subscriptions.discard(subscription)
            if not subscriptions:
                self._subscriptions.pop(subscription.server_id, None)

        key = (subscription.server_id, subscription.member_id)
        count = self._member_connections.get(key, 0)
        if count <= 1:
            self._member_connections.pop(key, None)
            return True

        self._member_connections[key] = count - 1
        return False

    def subscribe_channel(self, subscription: Subscription, channel_id: str) -> None:
        subscription.channels.add(channel_id)

    def unsubscribe_channel(self, subscription: Subscription, channel_id: str) -> None:
        subscription.channels.discard(channel_id)

    async def publish(self, event: Event, *, exclude: Subscription | None = None) -> None:
        for subscription in tuple(self._subscriptions.get(event["server_id"], ())):
            if subscription is exclude:
                continue
            subscription.offer(event)

    def reset(self) -> None:
        self._subscriptions.clear()
        self._member_connections.clear()


event_bus = EventBus()
