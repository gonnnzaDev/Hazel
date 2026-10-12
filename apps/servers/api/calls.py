"""Endpoints de llamadas: el WebSocket de señalización y el listado de sala.

La capa HTTP ↔ servicio. No hay reglas de negocio acá: la sala, la concurrencia
y los mensajes viven en `apps.servers.calls`. Este módulo solo traduce.

## El WebSocket

    ws://host/api/v1/servers/{server_id}/channels/{channel_id}/call?token=...

El handshake lleva el token por query string porque ni el navegador ni los
clientes mobile permiten headers custom al abrir un WebSocket. Es la misma
restricción que ya maneja `apps.identity.deps.member_from_query`.

Lo que entra y sale por este socket es señalización: descripciones SDP y
candidatos ICE que el servidor reenvía entre pares, más anuncios de sala
(entró, salió, cambió el micrófono). El audio y el vídeo **no pasan por acá**:
viajan directo entre los navegadores por WebRTC.

## El contrato de mensajes

Cliente → servidor:

    {"type": "offer"|"answer", "to": "<member_id>", "sdp": {...}}
    {"type": "ice", "to": "<member_id>", "candidate": {...}}
    {"type": "state", "mic": bool, "cam": bool}

Servidor → cliente:

    {"type": "welcome", "you": "<id>", "peers": [...], "ice_servers": [...]}
    {"type": "peer-joined", "peer": {...}}
    {"type": "peer-left", "member_id": "<id>"}
    {"type": "peer-state", "member_id": "<id>", "mic": bool, "cam": bool}
    {"type": "offer"|"answer", "from": "<id>", "payload": {...sdp...}}
    {"type": "ice", "from": "<id>", "payload": {...candidate...}}
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Path, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from apps.common.types import RecordId
from apps.identity import services as identity_services
from apps.identity.deps import CurrentMember
from apps.servers import services as servers_services
from apps.servers.calls import (
    Peer,
    call_manager,
    is_forwardable,
    message_kind,
    parse_signal,
)
from apps.servers.models import Channel
from core.api.deps import SettingsDep
from core.api.errors import (
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
)
from core.db.session import session_scope

router = APIRouter()


@dataclass(slots=True)
class CallIdentity:
    """Quién está entrando a la llamada, ya verificado contra la base.

    Es lo mínimo que el señalizador necesita saber: la identidad pública del
    participante. No guarda la sesión ni el `Member` completo.
    """

    member_id: str
    nickname: str
    display_name: str


async def resolve_identity(server_id: str, channel_id: str, token: str) -> CallIdentity:
    """Verifica token, servidor, canal y pertenencia. Devuelve la identidad.

    Se separa del endpoint para poder testearla aislada y para que el endpoint
    quede lineal: aceptar, resolver, entrar, loop. Los tests la reemplazan sin
    tocar la base.

    El orden importa: primero el token (¿sos alguien?), después el servidor
    (¿existe?), después que tu token sea de *este* servidor (¿sos alguien acá?),
    y por último el canal. Un token de otro servidor queda rechazado aunque el
    servidor exista, que es la garantía de que la identidad no es global.
    """
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
        member = await identity_services.authenticate(session, token)
        server = await servers_services.get_server(session, sid)

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
    """Procesa un mensaje crudo del cliente.

    Tres casos, y solo tres: reenviar SDP/ICE a un par concreto, o actualizar el
    estado de micrófono/cámara y avisar a la sala. Cualquier otra cosa se
    descarta: el señalizador no interpreta, solo enruta.
    """
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
                # `sdp` o `candidate`, indistintamente: el servidor no mira dentro.
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
    """Convierte lo que mandó el cliente a bool. Si no es bool, deja el actual."""
    return value if isinstance(value, bool) else default


@router.websocket("/{server_id}/channels/{channel_id}/call")
async def call_signaling(
    websocket: WebSocket,
    server_id: str,
    channel_id: str,
    settings: SettingsDep,
) -> None:
    """El socket de una llamada. Señaliza, no transmite.

    El ciclo es: aceptar → verificar identidad → entrar a la sala y que la sala
    me conozca → avisar a los demás → quedarme reenviando hasta que me vaya. Al
    irme, salgo y aviso, pase lo que pase: el `finally` es lo que garantiza que
    una sala no quede con un fantasma dentro.
    """
    await websocket.accept()

    token = (websocket.query_params.get("token") or "").strip()
    try:
        identity = await resolve_identity(server_id, channel_id, token)
    except Exception as exc:
        # Antes del handshake no se puede responder con JSON: el canal de error
        # de un WebSocket es el código de cierre. 1008 es "policy violation",
        # que es exactamente lo que es un token inválido.
        await websocket.close(code=1008, reason=_close_reason(exc))
        return

    peer = Peer(
        member_id=identity.member_id,
        nickname=identity.nickname,
        display_name=identity.display_name,
        send=websocket.send_json,
    )

    existing = await call_manager.join(channel_id, peer)

    # Le doy al recién llegado la lista de quien ya está: con eso arma sus
    # ofertas. Y le paso los ICE servers que configuró el dueño, para que no
    # estén dispersos en el cliente.
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
    """Razón legible para el cierre del socket, acotada a lo que permite el protocolo."""
    code = getattr(exc, "code", None)
    reason = code if isinstance(code, str) else "unauthorized"
    # El reason de cierre tiene un límite de bytes; recortar antes que romper.
    return reason[:120]


class CallParticipant(BaseModel):
    """Un participante de la llamada, tal como lo ve la sala."""

    member_id: str
    nickname: str
    display_name: str
    mic: bool
    cam: bool


class CallParticipantsResponse(BaseModel):
    """Quién está en la llamada ahora mismo y cuántos pueden entrar todavía."""

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
    """Quién está conectado a la llamada de un canal, sin abrir el WebSocket.

    Es la mirada rápida que hace la UI antes de entrar: muestra los avatares de
    quien ya está adentro. No toca la base —la sala vive en memoria del
    proceso— y por eso es inmediato.

    El token ya scopea al servidor (`member.server_id`), así que alcanaza
    comparar con el de la ruta para saber que es tu servidor.
    """
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
