"""Call endpoints: signaling WebSocket plus room listing.

Token travels in the query string (WebSocket clients cannot set headers).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Path, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from common.types import RecordId
from core.api.deps import SettingsDep
from core.api.errors import (
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
)
from core.db.session import session_scope
from identity import service as identity_service
from identity.deps import CurrentMember
from servers import repository as servers_repository
from servers.calls import (
    Peer,
    call_manager,
    is_forwardable,
    message_kind,
    parse_signal,
)
from servers.model import Channel

router = APIRouter()


@dataclass(slots=True)
class CallIdentity:
    """Call participant identity, verified against the DB."""

    member_id: str
    nickname: str
    display_name: str


async def resolve_identity(server_id: str, channel_id: str, token: str) -> CallIdentity:
    """Verify token, server, membership, and channel — in that order."""
    if not token:
        raise AuthenticationError("Falta el token.", code="missing_token")

    try:
        sid = uuid.UUID(server_id)
        cid = uuid.UUID(channel_id)
    except (ValueError, AttributeError):
        raise NotFoundError(
            "El servidor o el canal no existe.",
            code="call_target_not_found",
        ) from None

    async with session_scope() as session:
        member = await identity_service.authenticate(session, token)
        server = await servers_repository.get_server(session, sid)

        if member.server_id != server.id:
            raise PermissionDeniedError(
                "Tu token es de otro servidor.",
                code="wrong_server",
            )

        channel = (
            await session.execute(
                select(Channel).where(Channel.id == cid, Channel.server_id == server.id)
            )
        ).scalar_one_or_none()

        if channel is None:
            raise NotFoundError(
                "El canal no existe en este servidor.",
                code="channel_not_found",
                extra={"channel_id": str(cid)},
            )

    return CallIdentity(
        member_id=str(member.id),
        nickname=member.nickname,
        display_name=member.display_name,
    )


async def _handle_message(channel_id: str, peer: Peer, raw: str) -> None:
    """Route one raw client message: relay SDP/ICE, apply state updates, drop the rest."""
    message = parse_signal(raw)
    if message is None:
        return

    kind = message_kind(message)
    if kind is None:
        return

    if is_forwardable(kind):
        target = message.get("to")
        if not isinstance(target, str) or not target:
            return
        await call_manager.send_to(
            channel_id,
            target,
            {
                "type": kind,
                "from": peer.member_id,
                # `sdp` or `candidate`; the server never inspects the payload.
                "payload": message.get("sdp") if kind != "ice" else message.get("candidate"),
            },
        )
        return

    if kind == "state":
        mic = _as_bool(message.get("mic"), default=peer.mic_on)
        cam = _as_bool(message.get("cam"), default=peer.cam_on)
        updated = await call_manager.set_state(channel_id, peer.member_id, mic=mic, cam=cam)
        if updated is not None:
            await call_manager.broadcast(
                channel_id,
                {
                    "type": "peer-state",
                    "member_id": peer.member_id,
                    "mic": updated.mic_on,
                    "cam": updated.cam_on,
                },
                exclude=peer.member_id,
            )


def _as_bool(value: object, *, default: bool) -> bool:
    """Coerce client input to bool, keeping the current value otherwise."""
    return value if isinstance(value, bool) else default


@router.websocket("/{server_id}/channels/{channel_id}/call")
async def call_signaling(
    websocket: WebSocket,
    server_id: str,
    channel_id: str,
    settings: SettingsDep,
) -> None:
    """One call socket: accept, verify, join, relay until disconnect; `finally` always leaves."""
    await websocket.accept()

    token = (websocket.query_params.get("token") or "").strip()
    try:
        identity = await resolve_identity(server_id, channel_id, token)
    except Exception as exc:
        # Pre-handshake errors use close codes (no JSON channel yet); 1008 = policy violation.
        await websocket.close(code=1008, reason=_close_reason(exc))
        return

    peer = Peer(
        member_id=identity.member_id,
        nickname=identity.nickname,
        display_name=identity.display_name,
        send=websocket.send_json,
    )

    existing = await call_manager.join(channel_id, peer)

    # Present the room and ICE servers so the newcomer can offer.
    await websocket.send_json(
        {
            "type": "welcome",
            "you": peer.member_id,
            "peers": [p.public() for p in existing],
            "ice_servers": list(settings.call_ice_servers),
        }
    )

    await call_manager.broadcast(
        channel_id,
        {"type": "peer-joined", "peer": peer.public()},
        exclude=peer.member_id,
    )

    try:
        while True:
            raw = await websocket.receive_text()
            await _handle_message(channel_id, peer, raw)
    except WebSocketDisconnect:
        pass
    finally:
        await call_manager.leave(channel_id, peer.member_id)
        await call_manager.broadcast(
            channel_id, {"type": "peer-left", "member_id": peer.member_id}
        )


def _close_reason(exc: Exception) -> str:
    """Human-readable close reason, truncated to the protocol limit."""
    code = getattr(exc, "code", None)
    reason = code if isinstance(code, str) else "unauthorized"
    return reason[:120]


class CallParticipant(BaseModel):
    """A call participant as seen by the room."""

    member_id: str
    nickname: str
    display_name: str
    mic: bool
    cam: bool


class CallParticipantsResponse(BaseModel):
    """Current call presence and capacity."""

    channel_id: str
    participants: list[CallParticipant] = Field(default_factory=list)
    count: int
    max: int


@router.get(
    "/{server_id}/channels/{channel_id}/call/participants",
    response_model=CallParticipantsResponse,
    summary="Quién está en la llamada",
)
async def call_participants(
    server_id: Annotated[RecordId, Path(description="Identificador del servidor")],
    channel_id: Annotated[str, Path(description="Identificador del canal")],
    member: CurrentMember,
    settings: SettingsDep,
) -> CallParticipantsResponse:
    """Peers in a channel's call (in-memory); the token must belong to this server."""
    if member.server_id != server_id:
        raise PermissionDeniedError(
            "Tu token es de otro servidor.",
            code="wrong_server",
        )

    return CallParticipantsResponse(
        channel_id=channel_id,
        participants=[CallParticipant(**p) for p in call_manager.snapshot(channel_id)],
        count=call_manager.count(channel_id),
        max=settings.call_max_participants,
    )
