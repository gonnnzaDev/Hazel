"""Server lifecycle endpoints (HTTP <-> service translation only)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request, status
from sqlalchemy import select

from common.types import RecordId
from core.api.deps import SessionDep
from core.api.errors import ConflictError, NotFoundError, PermissionDeniedError
from identity.deps import CurrentMember
from node import service as node_service
from node.schemas import NodeAddress
from servers import repository, service
from servers.model import Channel
from servers.schemas import (
    MessageCreate,
    MessageListResponse,
    MessageRead,
    ServerAddress,
    ServerCreate,
    ServerListResponse,
    ServerRead,
    ServerUpdate,
)

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Identificador del servidor")]
QueryLimit = Annotated[int, Query(ge=1, le=100, description="Máximo de servidores por página")]
QueryOffset = Annotated[int, Query(ge=0, description="Cuántos servidores saltar")]
ChannelId = Annotated[RecordId, Path(description="Identificador del canal")]


async def _channel_of(session: SessionDep, server_id: RecordId, channel_id: RecordId) -> Channel:
    """The channel, if it belongs to this server; 404 instead of 500 otherwise."""
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
    supervisor = node_service.supervisor_from(request)
    server = await node_service.create_group(session, supervisor, payload)
    return ServerRead.model_validate(server)


@router.get("", response_model=ServerListResponse, summary="Listar servidores")
async def list_servers(
    session: SessionDep, limit: QueryLimit = 20, offset: QueryOffset = 0
) -> ServerListResponse:
    """Node servers, newest first."""
    servers, total = await repository.list_servers(session, limit=limit, offset=offset)
    return ServerListResponse(
        items=[ServerRead.model_validate(s) for s in servers],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{server_id}", response_model=ServerRead, summary="Ver un servidor")
async def get_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Server detail with channels."""
    server = await repository.get_server(session, server_id)
    return ServerRead.model_validate(server)


@router.get("/by-slug/{slug}", response_model=ServerRead, summary="Buscar por identificador")
async def get_server_by_slug(
    session: SessionDep,
    slug: Annotated[str, Path(min_length=2, max_length=64)],
) -> ServerRead:
    """Resolve a server by its shareable slug."""
    server = await repository.resolve_by_slug(session, slug)
    return ServerRead.model_validate(server)


@router.patch("/{server_id}", response_model=ServerRead, summary="Editar un servidor")
async def update_server(
    server_id: ServerId, payload: ServerUpdate, session: SessionDep
) -> ServerRead:
    """Edit name, description, member limit, or port."""
    server = await repository.get_server(session, server_id)
    updated = await repository.update_server(session, server, payload)
    return ServerRead.model_validate(updated)


@router.post(
    "/{server_id}/activate",
    response_model=ServerRead,
    summary="Activar el servidor",
)
async def activate_server(
    server_id: ServerId,
    session: SessionDep,
    request: Request,
    response: Any = None,
) -> ServerRead:
    """Reopen the port of an inactive server; all data is intact."""
    try:
        supervisor = node_service.supervisor_from(request)
    except ConflictError:
        supervisor = None
    if supervisor is not None:
        started = await node_service.start_group(session, supervisor, server_id)
        return ServerRead.model_validate(started)

    server = await repository.get_server(session, server_id)
    activated = await service.activate_server(session, server)
    return ServerRead.model_validate(activated)


@router.post(
    "/{server_id}/deactivate",
    response_model=ServerRead,
    summary="Desactivar el servidor",
)
async def deactivate_server(
    server_id: ServerId,
    session: SessionDep,
    request: Request,
    response: Any = None,
) -> ServerRead:
    """Close the port; preserves all data for reactivation."""
    try:
        supervisor = node_service.supervisor_from(request)
    except ConflictError:
        supervisor = None
    if supervisor is not None:
        stopped = await node_service.stop_group(session, supervisor, server_id)
        return ServerRead.model_validate(stopped)

    server = await repository.get_server(session, server_id)
    deactivated = await service.deactivate_server(session, server)
    return ServerRead.model_validate(deactivated)


@router.post(
    "/{server_id}/heartbeat",
    response_model=ServerRead,
    summary="Reportar que el proceso sigue vivo",
)
async def heartbeat(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Record a heartbeat; distinguishes intentional stop from crash."""
    server = await repository.get_server(session, server_id)
    beat = await repository.heartbeat(session, server)
    return ServerRead.model_validate(beat)


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar el servidor",
)
async def delete_server(
    server_id: ServerId,
    session: SessionDep,
    request: Request,
    response: Any = None,
) -> None:
    """Permanently delete the server; irreversible."""
    try:
        supervisor = node_service.supervisor_from(request)
    except ConflictError:
        supervisor = None
    if supervisor is not None:
        await node_service.delete_group(session, supervisor, server_id)
        return

    server = await repository.get_server(session, server_id)
    await service.delete_server(session, server)


@router.get(
    "/{server_id}/address",
    response_model=ServerAddress,
    summary="Dirección para compartir",
)
async def get_address(server_id: ServerId, session: SessionDep) -> ServerAddress:
    """Join address for this server (nodes share one port; the slug routes)."""
    server = await repository.get_server(session, server_id)
    return ServerAddress(
        server_id=server.id,
        slug=server.slug,
        server_name=server.name,
        is_active=server.status.accepts_traffic,
        node=NodeAddress.model_validate(node_service.node_address()),
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
    """Write a text message to a server channel."""
    server = await repository.get_server(session, server_id)
    if member.server_id != server.id:
        raise PermissionDeniedError("Tu token es de otro servidor.", code="wrong_server")
    await _channel_of(session, server.id, channel_id)
    message = await repository.create_message(
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
    """Channel message history, newest first."""
    server = await repository.get_server(session, server_id)
    await _channel_of(session, server.id, channel_id)
    messages, total = await repository.list_messages(session, channel_id, limit=limit, offset=offset)
    return MessageListResponse(
        items=[MessageRead.model_validate(m) for m in messages],
        total=total,
        limit=limit,
        offset=offset,
    )
