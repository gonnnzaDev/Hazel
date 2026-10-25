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


@router.websocket("/ws")
async def ws_events(websocket: WebSocket) -> None:
    await websocket.accept()

    settings = get_settings()
    bus.configure(queue_size=settings.websocket_queue_size)

    async with get_session_maker()() as session:
        try:
            member = await authenticate(session, websocket.query_params.get("token") or "")
        except AuthenticationError:
            logger.info("ws rejected: bad token")
            await websocket.close(code=1008, reason="unauthenticated")
            return

        server = await session.get(Server, member.server_id)
        if server is None or not server.status.accepts_traffic:
            logger.info("ws rejected member=%s: server down", member.id)
            await websocket.close(code=1008, reason="server_inactive")
            return

        sub, first_socket = bus.subscribe(
            server_id=member.server_id,
            member_id=member.id,
            nickname=member.nickname,
            display_name=member.display_name,
        )
        member.is_online = True
        member.last_seen_at = utcnow()
        if first_socket:
            bus.publish(
                server_id=member.server_id,
                event=envelope(
                    "presence.update",
                    server_id=member.server_id,
                    data={
                        "nickname": member.nickname,
                        "display_name": member.display_name,
                        "is_online": True,
                    },
                ),
            )
        await session.commit()

        typing = TypingWindow()
        typing_limit = settings.typing_rate_per_minute
        idle_timeout = float(settings.websocket_idle_timeout_seconds)
        sender = asyncio.create_task(_writer(websocket, sub))

        try:
            while True:
                try:
                    raw = await asyncio.wait_for(websocket.receive(), timeout=idle_timeout)
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

                kind = payload.get("type")
                if kind == "heartbeat":
                    enqueue_direct(sub, {"type": "heartbeat"})
                elif kind == "channel.subscribe":
                    channel_id = _channel_id_of(payload)
                    if channel_id is None:
                        continue
                    channel = await session.get(Channel, channel_id)
                    if channel is not None and channel.server_id == member.server_id:
                        bus.subscribe_channel(sub, channel.id)
                elif kind == "typing.start":
                    channel_id = _channel_id_of(payload)
                    if channel_id is None or channel_id not in sub.channels:
                        continue
                    if not typing.admit(asyncio.get_running_loop().time(), limit=typing_limit):
                        continue
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
                # unknown event types are ignored, per contract
        except WebSocketDisconnect:
            pass
        finally:
            sender.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sender
            try:
                was_last = bus.unsubscribe(sub)
                if was_last:
                    bus.publish(
                        server_id=member.server_id,
                        event=envelope(
                            "presence.update",
                            server_id=member.server_id,
                            data={
                                "nickname": member.nickname,
                                "display_name": member.display_name,
                                "is_online": False,
                            },
                        ),
                    )
                member.is_online = False
                member.last_seen_at = utcnow()
                await session.commit()
            except Exception:
                logger.exception("failed to mark member=%s offline", member.id)
