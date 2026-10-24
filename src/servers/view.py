from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, Request, status

from common.types import RecordId
from core.api.deps import SessionDep
from node import service as node_service
from node.schemas import NodeAddress
from servers import repository, service
from servers.schemas import (
    ServerAddress,
    ServerCreate,
    ServerListResponse,
    ServerRead,
    ServerUpdate,
)

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Server identifier")]
QueryLimit = Annotated[int, Query(ge=1, le=100, description="Max servers per page")]
QueryOffset = Annotated[int, Query(ge=0, description="How many servers to skip")]


@router.post(
    "",
    response_model=ServerRead,
    status_code=status.HTTP_201_CREATED,
    summary="Deploy a server",
)
async def create_server(payload: ServerCreate, session: SessionDep, request: Request) -> ServerRead:
    supervisor = node_service.supervisor_from(request)
    server = await node_service.create_group(session, supervisor, payload)
    return ServerRead.model_validate(server)


@router.get("", response_model=ServerListResponse, summary="List servers")
async def list_servers(
    session: SessionDep, limit: QueryLimit = 20, offset: QueryOffset = 0
) -> ServerListResponse:
    servers, total = await repository.list_servers(session, limit=limit, offset=offset)
    return ServerListResponse(
        items=[ServerRead.model_validate(s) for s in servers],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{server_id}", response_model=ServerRead, summary="Get a server")
async def get_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    server = await repository.get_server(session, server_id)
    return ServerRead.model_validate(server)


@router.get("/by-slug/{slug}", response_model=ServerRead, summary="Find by identifier")
async def get_server_by_slug(
    session: SessionDep,
    slug: Annotated[str, Path(min_length=2, max_length=64)],
) -> ServerRead:
    server = await repository.resolve_by_slug(session, slug)
    return ServerRead.model_validate(server)


@router.patch("/{server_id}", response_model=ServerRead, summary="Update a server")
async def update_server(
    server_id: ServerId, payload: ServerUpdate, session: SessionDep
) -> ServerRead:
    server = await repository.get_server(session, server_id)
    updated = await repository.update_server(session, server, payload)
    return ServerRead.model_validate(updated)


@router.post(
    "/{server_id}/activate",
    response_model=ServerRead,
    summary="Activate the server",
)
async def activate_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    server = await repository.get_server(session, server_id)
    activated = await service.activate_server(session, server)
    return ServerRead.model_validate(activated)


@router.post(
    "/{server_id}/deactivate",
    response_model=ServerRead,
    summary="Deactivate the server",
)
async def deactivate_server(server_id: ServerId, session: SessionDep) -> ServerRead:
    server = await repository.get_server(session, server_id)
    deactivated = await service.deactivate_server(session, server)
    return ServerRead.model_validate(deactivated)


@router.post(
    "/{server_id}/heartbeat",
    response_model=ServerRead,
    summary="Report the process is still alive",
)
async def heartbeat(server_id: ServerId, session: SessionDep) -> ServerRead:
    server = await repository.get_server(session, server_id)
    beat = await repository.heartbeat(session, server)
    return ServerRead.model_validate(beat)


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete the server",
)
async def delete_server(server_id: ServerId, session: SessionDep) -> None:
    server = await repository.get_server(session, server_id)
    await service.delete_server(session, server)


@router.get(
    "/{server_id}/address",
    response_model=ServerAddress,
    summary="Shareable address",
)
async def get_address(server_id: ServerId, session: SessionDep) -> ServerAddress:
    server = await repository.get_server(session, server_id)
    node = NodeAddress.model_validate(node_service.node_address())
    return ServerAddress.from_server(server, node)
