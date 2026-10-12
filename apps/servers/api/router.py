"""Endpoints del ciclo de vida del servidor.

Esta capa solo traduce HTTP ↔ servicio. No contiene reglas de negocio: si
necesitás una validación, va en `services.py`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, Request, status
from sqlalchemy import select

from apps.common.types import RecordId
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

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Identificador del servidor")]
QueryLimit = Annotated[int, Query(ge=1, le=100, description="Máximo de servidores por página")]
QueryOffset = Annotated[int, Query(ge=0, description="Cuántos servidores saltar")]


@router.post(
    "",
    response_model=ServerRead,
    status_code=status.HTTP_201_CREATED,
    summary="Desplegar un servidor",
)
async def create_server(payload: ServerCreate, session: SessionDep, request: Request) -> ServerRead:
    """Crea un servidor en tu máquina y abre su puerto.

    En la app del nodo, esto delega en `apps.node.services.create_group`, que
    además asigna el puerto y levanta el proceso del grupo. Esta ruta queda para
    el modo de un solo proceso (desarrollo y tests), donde no hay supervisor.

    En un proceso de grupo esta ruta no tiene sentido: un grupo no crea otros
    grupos. Por eso pide el supervisor y falla con un mensaje claro si no lo hay.
    """
    supervisor = node_services.supervisor_from(request)
    server = await node_services.create_group(session, supervisor, payload)
    return ServerRead.model_validate(server)


@router.get("", response_model=ServerListResponse, summary="Listar servidores")
async def list_servers(
    session: SessionDep, limit: QueryLimit = 20, offset: QueryOffset = 0
) -> ServerListResponse:
    """Paginado de servidores del nodo, del más reciente al más viejo."""
    servers, total = await services.list_servers(session, limit=limit, offset=offset)
    return ServerListResponse(
        items=[ServerRead.model_validate(s) for s in servers],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{server_id}", response_model=ServerRead, summary="Ver un servidor")
async def get_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Detalle de un servidor, con sus canales."""
    server = await services.get_server(session, server_id)
    return ServerRead.model_validate(server)


@router.get("/by-slug/{slug}", response_model=ServerRead, summary="Buscar por identificador")
async def get_server_by_slug(
    session: SessionDep,
    slug: Annotated[str, Path(min_length=2, max_length=64)],
) -> ServerRead:
    """Resuelve un servidor por su identificador compartible."""
    server = await services.resolve_by_slug(session, slug)
    return ServerRead.model_validate(server)


@router.patch("/{server_id}", response_model=ServerRead, summary="Editar un servidor")
async def update_server(
    server_id: ServerId, payload: ServerUpdate, session: SessionDep
) -> ServerRead:
    """Cambia nombre, descripción, límite de miembros o puerto."""
    server = await services.get_server(session, server_id)
    updated = await services.update_server(session, server, payload)
    return ServerRead.model_validate(updated)


@router.post(
    "/{server_id}/activate",
    response_model=ServerRead,
    summary="Activar el servidor",
)
async def activate_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Vuelve a abrir el puerto de un servidor inactivo.

    Todos los datos siguen ahí: esto es una一个男人 reapertura, no una
    recuperación de nada.
    """
    server = await services.get_server(session, server_id)
    activated = await services.activate_server(session, server)
    return ServerRead.model_validate(activated)


@router.post(
    "/{server_id}/deactivate",
    response_model=ServerRead,
    summary="Desactivar el servidor",
)
async def deactivate_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Cierra el puerto y deja el servidor inactivo.

    **No borra nada.** Los canales, los miembros y los mensajes se conservan
    intactos y el servidor se puede volver a activar en cualquier momento.
    """
    server = await services.get_server(session, server_id)
    deactivated = await services.deactivate_server(session, server)
    return ServerRead.model_validate(deactivated)


@router.post(
    "/{server_id}/heartbeat",
    response_model=ServerRead,
    summary="Reportar que el proceso sigue vivo",
)
async def heartbeat(server_id: ServerId, session: SessionDep) -> ServerRead:
    """Actualiza el latido del proceso.

    Permite distinguir "el dueño lo apagó" de "el proceso se cayó".
    """
    server = await services.get_server(session, server_id)
    beat = await services.heartbeat(session, server)
    return ServerRead.model_validate(beat)


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar el servidor",
)
async def delete_server(server_id: ServerId, session: SessionDep) -> None:
    """Elimina el servidor de forma permanente.

    Es destructivo e irreversible: a diferencia de desactivar, acá no queda nada.
    """
    server = await services.get_server(session, server_id)
    await services.delete_server(session, server)


@router.get(
    "/{server_id}/address",
    response_model=ServerAddress,
    summary="Dirección para compartir",
)
async def get_address(server_id: ServerId, session: SessionDep) -> ServerAddress:
    """Dirección por la que entrar a este servidor.

    Todos los servidores del nodo comparten el puerto. Lo que los distingue es
    el slug, así que la dirección que se comparte es la del nodo.
    """
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
    channel_id: Annotated[RecordId, Path(description="Identificador del canal")],
    payload: MessageCreate,
    session: SessionDep,
) -> MessageRead:
    """Escribe un mensaje de texto en un canal del servidor.

    El mensaje queda guardado en la base local del grupo y se muestra a los
    miembros que entren después. No usa Kafka todavía: es la Fase 1 de chat.
    """
    server = await services.get_server(session, server_id)
    # Verificamos que el channel pertenezca a este servidor
    stmt = select(Channel).where(Channel.id == channel_id, Channel.server_id == server.id)
    (await session.execute(stmt)).scalar_one()
    message = await services.create_message(
        session, channel_id=channel_id, author_nickname="anon", content=payload.content
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
    channel_id: Annotated[RecordId, Path(description="Identificador del canal")],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MessageListResponse:
    """Devuelve el historial de mensajes de un canal, más recientes primero.

    Los mensajes son locales al grupo: solo se ven los pertenecientes a este
    servidor y canal. Si luego se habilita Kafka, los mensajes cruzados entre
    grupos del mismo dueño se pueden sincronizar.
    """
    # (the server check happens inside)
