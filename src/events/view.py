from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from core.api.errors import DomainError
from events import service
from events.bus import Event, Subscription, build_event, event_bus
from events.service import ConnectionIdentity
from identity.deps import query_token

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_CLIENT_EVENT_BYTES = 8_192


def _close_reason(exc: Exception) -> str:
    code = getattr(exc, "code", None)
    reason = code if isinstance(code, str) else "unauthorized"
    return reason[:120]


def _member_payload(identity: ConnectionIdentity) -> dict[str, Any]:
    return {
        "id": identity.member_id,
        "nickname": identity.nickname,
        "display_name": identity.display_name,
    }


def _server_payload(identity: ConnectionIdentity) -> dict[str, Any]:
    return {
        "id": identity.server_id,
        "slug": identity.server_slug,
        "name": identity.server_name,
    }


def _ready_event(identity: ConnectionIdentity) -> Event:
    return build_event(
        "connection.ready",
        identity.server_id,
        {
            "member": _member_payload(identity),
            "server": _server_payload(identity),
        },
    )


def _presence_event(identity: ConnectionIdentity, *, online: bool) -> Event:
    return build_event(
        "presence.update",
        identity.server_id,
        {
            "member": _member_payload(identity),
            "online": online,
        },
    )


def _error_event(server_id: str, code: str, detail: str) -> Event:
    return build_event(
        "error",
        server_id,
        {"code": code, "detail": detail},
    )


async def _handle_client_event(subscription: Subscription, raw: str) -> None:
    try:
        message = json.loads(raw)
    except TypeError, ValueError:
        subscription.offer(
            _error_event(subscription.server_id, "invalid_json", "The event is not valid JSON.")
        )
        return

    if not isinstance(message, dict):
        subscription.offer(
            _error_event(
                subscription.server_id,
                "invalid_event",
                "The event must be a JSON object.",
            )
        )
        return

    kind = message.get("type")
    if kind == "channel.subscribe":
        await _subscribe_channel(subscription, message)
    elif kind == "channel.unsubscribe":
        _unsubscribe_channel(subscription, message)
    elif kind == "typing.start":
        await _typing_start(subscription, message)
    elif kind == "heartbeat":
        subscription.offer(
            build_event(
                "heartbeat",
                subscription.server_id,
                {"server_time": datetime.now(UTC).isoformat()},
            )
        )


def _channel_id(message: dict[str, Any]) -> str | None:
    value = message.get("channel_id")
    if not isinstance(value, str):
        return None
    return value.strip() or None


async def _subscribe_channel(subscription: Subscription, message: dict[str, Any]) -> None:
    channel_id = _channel_id(message)
    if channel_id is None:
        subscription.offer(
            _error_event(
                subscription.server_id,
                "invalid_channel_id",
                "A valid channel_id is required.",
            )
        )
        return

    if not await service.channel_exists(subscription.server_id, channel_id):
        subscription.offer(
            _error_event(
                subscription.server_id,
                "channel_not_found",
                "That channel does not exist on this server.",
            )
        )
        return

    event_bus.subscribe_channel(subscription, channel_id)
    subscription.offer(
        build_event(
            "channel.subscribed",
            subscription.server_id,
            {},
            channel_id=channel_id,
        )
    )


def _unsubscribe_channel(subscription: Subscription, message: dict[str, Any]) -> None:
    channel_id = _channel_id(message)
    if channel_id is None:
        subscription.offer(
            _error_event(
                subscription.server_id,
                "invalid_channel_id",
                "A valid channel_id is required.",
            )
        )
        return

    event_bus.unsubscribe_channel(subscription, channel_id)
    subscription.offer(
        build_event(
            "channel.unsubscribed",
            subscription.server_id,
            {"channel_id": channel_id},
        )
    )


async def _typing_start(subscription: Subscription, message: dict[str, Any]) -> None:
    channel_id = _channel_id(message)
    if channel_id is None:
        subscription.offer(
            _error_event(
                subscription.server_id,
                "invalid_channel_id",
                "A valid channel_id is required.",
            )
        )
        return

    if channel_id not in subscription.channels:
        subscription.offer(
            _error_event(
                subscription.server_id,
                "not_subscribed",
                "Subscribe to the channel before sending typing events.",
            )
        )
        return

    await event_bus.publish(
        build_event(
            "typing.start",
            subscription.server_id,
            {
                "member": {
                    "id": subscription.member_id,
                    "nickname": subscription.nickname,
                    "display_name": subscription.display_name,
                }
            },
            channel_id=channel_id,
        ),
        exclude=subscription,
    )


async def _writer(websocket: WebSocket, subscription: Subscription) -> None:
    try:
        while True:
            event = await subscription.queue.get()
            if subscription.overflowed:
                await websocket.close(code=1011, reason="slow_consumer")
                return
            await websocket.send_json(event)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.debug("websocket writer stopped for member=%s", subscription.member_id)
        with suppress(Exception):
            await websocket.close(code=1011, reason="send_failed")


@router.websocket("/ws")
async def websocket_events(websocket: WebSocket) -> None:
    await websocket.accept()

    token = query_token(websocket.query_params.get("token"))
    try:
        identity = await service.authenticate_connection(token)
    except DomainError as exc:
        await websocket.close(code=1008, reason=_close_reason(exc))
        return
    except Exception:
        logger.exception("websocket authentication failed")
        await websocket.close(code=1011, reason="internal_error")
        return

    subscription, first_connection = event_bus.subscribe(
        server_id=identity.server_id,
        member_id=identity.member_id,
        nickname=identity.nickname,
        display_name=identity.display_name,
    )
    subscription.offer(_ready_event(identity))

    writer = asyncio.create_task(_writer(websocket, subscription))

    if first_connection:
        try:
            await service.set_presence(identity.member_id, online=True)
        except Exception:
            logger.exception("could not mark member online member=%s", identity.member_id)
        else:
            await event_bus.publish(_presence_event(identity, online=True))

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode("utf-8")) > MAX_CLIENT_EVENT_BYTES:
                await websocket.close(code=1009, reason="event_too_large")
                break
            await _handle_client_event(subscription, raw)
    except WebSocketDisconnect:
        pass
    finally:
        writer.cancel()
        with suppress(asyncio.CancelledError):
            await writer

        last_connection = event_bus.unsubscribe(subscription)
        if last_connection:
            try:
                await service.set_presence(identity.member_id, online=False)
            except Exception:
                logger.exception("could not mark member offline member=%s", identity.member_id)
            finally:
                await event_bus.publish(_presence_event(identity, online=False))

        with suppress(Exception):
            await websocket.close()
