"""WS /api/v1/ws: the general realtime stream, token by query param."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from channels.model import Channel
from common.types import utcnow
from config.bdd_config.bdd_config import get_session_maker
from config.conf import get_settings
from core.api.errors import AuthenticationError
from events.bus import Subscription, TypingWindow, bus, enqueue_direct, envelope
from identity.service import authenticate
from servers.model import Server

logger = logging.getLogger(__name__)

router = APIRouter()


async def _writer(websocket: WebSocket, sub: Subscription) -> None:
    """Single sender: everything a socket emits goes through its queue."""
    while not sub.closed:
        try:
            event = await asyncio.wait_for(sub.queue.get(), timeout=0.5)
        except TimeoutError:
            continue
        try:
            await websocket.send_text(json.dumps(event))
        except Exception:
            return


def _payload_text(raw: Mapping[str, Any]) -> str | None:
    text = raw.get("text")
    return text if isinstance(text, str) else None


def _channel_id_of(payload: dict[str, Any]) -> uuid.UUID | None:
    raw = payload.get("channel_id")
    if not isinstance(raw, str):
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None

#Web sockets events

async def authenticate_connection(
    websocket: WebSocket,
    session: AsyncSession,
):
    try:
        member = await authenticate(
            session,
            websocket.query_params.get("token") or "",
        )
    except AuthenticationError:
        logger.info("ws rejected: bad token")
        await websocket.close(code=1008, reason="unauthenticated")
        return None

    server = await session.get(Server, member.server_id)

    if server is None or not server.status.accepts_traffic:
        logger.info("ws rejected member=%s: server down", member.id)
        await websocket.close(code=1008, reason="server_inactive")
        return None

    return member, server


def create_subscription(member):
    return bus.subscribe(
        server_id=member.server_id,
        member_id=member.id,
        nickname=member.nickname,
        display_name=member.display_name,
    )


def publish_presence(member, is_online: bool) -> None:
    bus.publish(
        server_id=member.server_id,
        event=envelope(
            "presence.update",
            server_id=member.server_id,
            data={
                "nickname": member.nickname,
                "display_name": member.display_name,
                "is_online": is_online,
            },
        ),
    )


def publish_connection_ready(member, server) -> None:
    bus.publish(
        server_id=member.server_id,
        event=envelope(
            "connection.ready",
            server_id=member.server_id,
            data={
                "member_id": str(member.id),
                "nickname": member.nickname,
                "display_name": member.display_name,
                "server_id": str(member.server_id),
                "server_slug": server.slug,
                "server_name": server.name,
            },
        ),
    )


async def register_connection(
    session: AsyncSession,
    member,
    server,
    first_socket: bool,
) -> None:
    member.is_online = True
    member.last_seen_at = utcnow()

    if first_socket:
        publish_presence(member, True)

    publish_connection_ready(member, server)

    await session.commit()


async def unregister_connection(
    session: AsyncSession,
    member,
    sub,
) -> None:
    try:
        was_last = bus.unsubscribe(sub)

        if was_last:
            publish_presence(member, False)
            member.is_online = False

        member.last_seen_at = utcnow()

        await session.commit()

    except Exception:
        logger.exception(
            "failed to mark member=%s offline",
            member.id,
        )


def publish_error(
    server_id,
    code: str,
    detail: str,
) -> None:
    bus.publish(
        server_id=server_id,
        event=envelope(
            "error",
            server_id=server_id,
            data={
                "code": code,
                "detail": detail,
            },
        ),
    )


async def handle_channel_subscribe(
    payload,
    session: AsyncSession,
    member,
    sub,
) -> None:
    channel_id = _channel_id_of(payload)

    if channel_id is None:
        publish_error(
            member.server_id,
            "invalid_channel_subscribe",
            "channel_id must be a uuid",
        )
        return

    channel = await session.get(Channel, channel_id)

    if channel is None or channel.server_id != member.server_id:
        return

    bus.subscribe_channel(sub, channel.id)

    bus.publish(
        server_id=member.server_id,
        channel_id=channel.id,
        event=envelope(
            "channel.subscribed",
            server_id=member.server_id,
            channel_id=channel.id,
            data={"channel_id": str(channel.id)},
        ),
    )


def handle_channel_unsubscribe(
    payload,
    member,
    sub,
) -> None:
    channel_id = _channel_id_of(payload)

    if channel_id is None:
        publish_error(
            member.server_id,
            "invalid_channel_unsubscribe",
            "channel_id must be a uuid",
        )
        return

    if channel_id not in sub.channels:
        return

    bus.unsubscribe_channel(sub, channel_id)

    bus.publish(
        server_id=member.server_id,
        channel_id=channel_id,
        event=envelope(
            "channel.unsubscribed",
            server_id=member.server_id,
            channel_id=channel_id,
            data={"channel_id": str(channel_id)},
        ),
    )


def handle_typing(
    payload,
    member,
    sub,
    typing,
    typing_limit: int,
) -> None:
    channel_id = _channel_id_of(payload)

    if channel_id is None or channel_id not in sub.channels:
        return

    now = asyncio.get_running_loop().time()

    if not typing.admit(now, limit=typing_limit):
        return

    bus.publish(
        server_id=member.server_id,
        channel_id=channel_id,
        event=envelope(
            "typing.start",
            server_id=member.server_id,
            channel_id=channel_id,
            data={"nickname": member.nickname},
        ),
    )


async def handle_event(
    payload,
    session: AsyncSession,
    member,
    sub,
    typing,
    settings,
) -> None:
    kind = payload.get("type")

    if kind == "heartbeat":
        enqueue_direct(sub, {"type": "heartbeat"})
        return

    if kind == "channel.subscribe":
        await handle_channel_subscribe(
            payload, session, member, sub
        )
        return

    if kind == "channel.unsubscribe":
        handle_channel_unsubscribe(
            payload, member, sub
        )
        return

    if kind == "typing.start":
        handle_typing(
            payload,
            member,
            sub,
            typing,
            settings.typing_rate_per_minute,
        )
        return

    publish_error(
        member.server_id,
        "unknown_event_type",
        f"Unsupported event type: {kind}",
    )


async def receive_events(
    websocket: WebSocket,
    session: AsyncSession,
    member,
    sub,
    typing,
    settings,
) -> None:
    idle_timeout = float(
        settings.websocket_idle_timeout_seconds
    )

    while True:
        try:
            raw = await asyncio.wait_for(
                websocket.receive(),
                timeout=idle_timeout,
            )
        except TimeoutError:
            await websocket.close(code=1000, reason="idle")
            break
        except WebSocketDisconnect:
            break

        if raw.get("type") == "websocket.disconnect":
            break

        text = _payload_text(raw)

        if text is None:
            continue

        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue

        if not isinstance(payload, dict):
            continue

        await handle_event(
            payload=payload,
            session=session,
            member=member,
            sub=sub,
            typing=typing,
            settings=settings,
        )


async def cleanup_connection(
    sender: asyncio.Task | None,
    session: AsyncSession,
    member,
    sub,
) -> None:
    if sender is not None:
        sender.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await sender

    await unregister_connection(
        session=session,
        member=member,
        sub=sub,
    )


@router.websocket("/ws")
async def ws_events(websocket: WebSocket) -> None:
    await websocket.accept()

    settings = get_settings()
    bus.configure(queue_size=settings.websocket_queue_size)

    async with get_session_maker()() as session:
        connection = await authenticate_connection(
            websocket,
            session,
        )

        if connection is None:
            return

        member, server = connection
        sub, first_socket = create_subscription(member)

        sender = None

        try:
            await register_connection(
                session=session,
                member=member,
                server=server,
                first_socket=first_socket,
            )

            sender = asyncio.create_task(_writer(websocket, sub))

            await receive_events(
                websocket=websocket,
                session=session,
                member=member,
                sub=sub,
                typing=TypingWindow(),
                settings=settings,
            )

        except WebSocketDisconnect:
            pass

        finally:
            await cleanup_connection(
                sender=sender,
                session=session,
                member=member,
                sub=sub,
            )


# websocket events 
