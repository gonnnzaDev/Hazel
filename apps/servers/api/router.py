"""Server lifecycle endpoints (HTTP <-> service translation only)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request, status
from sqlalchemy import select

from apps.common.types import RecordId
from apps.identity.deps import CurrentMember
from apps.node import services as node_services
from apps.node.schemas import NodeAddress
from apps.servers import services
from apps.servers.models import Channel
from apps.servers.schemas import (
    MessageCreate,
    MessageListResponse,
    MessageRead,
    ServerAddress,
    ServerCreate,
    ServerListResponse,
    ServerRead,
    ServerUpdate,
)
from core.api.deps import SessionDep
from core.api.errors import NotFoundError, PermissionDeniedError

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Identificador del servidor")]
QueryLimit = Annotated[int, Query(ge=1, le=100, description="Máximo de servidores por página")]
QueryOffset = Annotated[int, Query(ge=0, description="Cuántos servidores saltar")]
ChannelId = Annotated[RecordId, Path(description="Identificador del canal")]


def _supervisor(request: Request) -> Any | None:
    """El supervisor de grupos, si este proceso es el nodo.

    En el nodo, encender y apagar un grupo es levantar y bajar su proceso; sin
    supervisor (modo de un solo proceso, tests) solo cambia el estado en la base.
    """
    return getattr(request.app.state, "supervisor", None)


async def _channel_of(session: SessionDep, server_id: RecordId, channel_id: RecordId) -> Channel:
    """El canal, si pertenece a este servidor. Si no, 404 en vez de un 500."""
    stmt = select(Channel).where(Channel.id == channel_id, Channel.server_id == server_id)
    channel = (await session.execute(stmt)).scalar_one_or_none()
    if channel is None:
        raise NotFoundError(
            "El canal no existe en este servidor.",
            code="channel_not_found",
            extra={"channel_id": str(channel_id)},
        )
    return channel


@router.post(
    "",
    response_model=ServerRead,
    status_code=status.HTTP_201_CREATED,
    summary="Desplegar un servidor",
)
async def create_server(payload: ServerCreate, session: SessionDep, request: Request) -> ServerRead:
    """Deploy a server; delegates port allocation and process startup to the node service."""
    supervisor = node_services.supervisor_from(request)
    server = await node_services.create_group(session, supervisor, payload)
    return ServerRead.model_validate(server)


@router.get("", response_model=ServerListResponse, summary="Listar servidores")
async def list_servers(
    session: SessionDep, limit: QueryLimit = 20, offset: QueryOffset = 0
) -> ServerListResponse:
    """Node servers, newest first."""
    servers, total = await services.list_servers(session, limit=limit, offset=offset)
    return ServerListResponse(
        items=[ServerRead.model_validate(s) for s in servers],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{server_id}", response_model=ServerRead, summary="Ver un servidor")
async def get_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Server detail with channels."""
    server = await services.get_server(session, server_id)
    return ServerRead.model_validate(server)


@router.get("/by-slug/{slug}", response_model=ServerRead, summary="Buscar por identificador")
async def get_server_by_slug(
    session: SessionDep,
    slug: Annotated[str, Path(min_length=2, max_length=64)],
) -> ServerRead:
    """Resolve a server by its shareable slug."""
    server = await services.resolve_by_slug(session, slug)
    return ServerRead.model_validate(server)


@router.patch("/{server_id}", response_model=ServerRead, summary="Editar un servidor")
async def update_server(
    server_id: ServerId, payload: ServerUpdate, session: SessionDep
) -> ServerRead:
    """Edit name, description, member limit, or port."""
    server = await services.get_server(session, server_id)
    updated = await services.update_server(session, server, payload)
    return ServerRead.model_validate(updated)


@router.post(
    "/{server_id}/activate",
    response_model=ServerRead,
    summary="Activar el servidor",
)
<<<<<<< HEAD
async def activate_server(server_id: ServerId, session: SessionDep, request: Request) -> ServerRead:
    """Vuelve a abrir el puerto de un servidor inactivo.

    Todos los datos siguen ahí: esto es una reapertura, no una recuperación de
    nada. En el nodo levanta el proceso del grupo; si no, el puerto no se abriría.
    """
    supervisor = _supervisor(request)
    if supervisor is not None:
        started = await node_services.start_group(session, supervisor, server_id)
        return ServerRead.model_validate(started)

=======
async def activate_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Reopen the port of an inactive server; all data is intact."""
>>>>>>> 6f27385 (chore: translate comments to English, keep essentials)
    server = await services.get_server(session, server_id)
    activated = await services.activate_server(session, server)
    return ServerRead.model_validate(activated)


@router.post(
    "/{server_id}/deactivate",
    response_model=ServerRead,
    summary="Desactivar el servidor",
)
<<<<<<< HEAD
async def deactivate_server(
    server_id: ServerId, session: SessionDep, request: Request
) -> ServerRead:
    """Cierra el puerto y deja el servidor inactivo.

    **No borra nada.** Los canales, los miembros y los mensajes se conservan
    intactos y el servidor se puede volver a activar en cualquier momento.
    """
    supervisor = _supervisor(request)
    if supervisor is not None:
        stopped = await node_services.stop_group(session, supervisor, server_id)
        return ServerRead.model_validate(stopped)

=======
async def deactivate_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Close the port; preserves all data for reactivation."""
>>>>>>> 6f27385 (chore: translate comments to English, keep essentials)
    server = await services.get_server(session, server_id)
    deactivated = await services.deactivate_server(session, server)
    return ServerRead.model_validate(deactivated)


@router.post(
    "/{server_id}/heartbeat",
    response_model=ServerRead,
    summary="Reportar que el proceso sigue vivo",
)
async def heartbeat(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Record a heartbeat; distinguishes intentional stop from crash."""
    server = await services.get_server(session, server_id)
    beat = await services.heartbeat(session, server)
    return ServerRead.model_validate(beat)


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar el servidor",
)
<<<<<<< HEAD
async def delete_server(server_id: ServerId, session: SessionDep, request: Request) -> None:
    """Elimina el servidor de forma permanente.

    Es destructivo e irreversible: a diferencia de desactivar, acá no queda nada.
    """
    supervisor = _supervisor(request)
    if supervisor is not None:
        await node_services.delete_group(session, supervisor, server_id)
        return

=======
async def delete_server(server_id: ServerId, session: SessionDep) -> None:
    """Permanently delete the server; irreversible."""
>>>>>>> 6f27385 (chore: translate comments to English, keep essentials)
    server = await services.get_server(session, server_id)
    await services.delete_server(session, server)


@router.get(
    "/{server_id}/address",
    response_model=ServerAddress,
    summary="Dirección para compartir",
)
async def get_address(server_id: ServerId, session: SessionDep) -> ServerAddress:
    """Join address for this server (nodes share one port; the slug routes)."""
    server = await services.get_server(session, server_id)
    return ServerAddress(
        server_id=server.id,
        slug=server.slug,
        server_name=server.name,
        is_active=server.status.accepts_traffic,
        node=NodeAddress.model_validate(node_services.node_address()),
    )


@router.post(
    "/{server_id}/channels/{channel_id}/messages",
    response_model=MessageRead,
    summary="Enviar un mensaje de texto",
)
async def create_message(
    server_id: ServerId,
    channel_id: ChannelId,
    payload: MessageCreate,
    session: SessionDep,
    member: CurrentMember,
) -> MessageRead:
<<<<<<< HEAD
    """Escribe un mensaje de texto en un canal del servidor.

    El mensaje queda guardado en la base local del grupo y se muestra a los
    miembros que entren después. No usa Kafka todavía: es la Fase 1 de chat.

    El autor es quien manda el token, no un campo del cuerpo: si no, cualquiera
    podría escribir con el nombre de otro.
    """
    server = await services.get_server(session, server_id)
    if member.server_id != server.id:
        raise PermissionDeniedError("Tu token es de otro servidor.", code="wrong_server")
    await _channel_of(session, server.id, channel_id)
=======
    """Write a text message to a server channel."""
    server = await services.get_server(session, server_id)
    # Ensure the channel belongs to this server.
    stmt = select(Channel).where(Channel.id == channel_id, Channel.server_id == server.id)
    (await session.execute(stmt)).scalar_one()
>>>>>>> 6f27385 (chore: translate comments to English, keep essentials)
    message = await services.create_message(
        session, channel_id=channel_id, author_nickname=member.nickname, content=payload.content
    )
    return MessageRead.model_validate(message)


@router.get(
    "/{server_id}/channels/{channel_id}/messages",
    response_model=MessageListResponse,
    summary="Listar mensajes de un canal",
)
async def list_messages(
    session: SessionDep,
    server_id: ServerId,
    channel_id: ChannelId,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MessageListResponse:
<<<<<<< HEAD
    """Devuelve el historial de mensajes de un canal, más recientes primero.

    Los mensajes son locales al grupo: solo se ven los pertenecientes a este
    servidor y canal. Si luego se habilita Kafka, los mensajes cruzados entre
    grupos del mismo dueño se pueden sincronizar.
    """
    server = await services.get_server(session, server_id)
    await _channel_of(session, server.id, channel_id)
    messages, total = await services.list_messages(session, channel_id, limit=limit, offset=offset)
    return MessageListResponse(
        items=[MessageRead.model_validate(m) for m in messages],
        total=total,
        limit=limit,
        offset=offset,
    )
=======
    """Channel message history, newest first."""
    # (the server check happens inside)
>>>>>>> 6f27385 (chore: translate comments to English, keep essentials)
