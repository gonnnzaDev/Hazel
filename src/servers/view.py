from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, Request, status

from common.types import RecordId
from core.api.admin import AdminAuth
from core.api.deps import SessionDep
from events.outbox import queue_event
from identity.deps import CurrentMember
from node import service as node_service
from node.schemas import NodeAddress
from servers import repository, service
from servers.schemas import (
    InviteCreate,
    InviteRead,
    ServerAddress,
    ServerCreate,
    ServerListResponse,
    ServerRead,
    ServerStats,
    ServerUpdate,
)

router = APIRouter()
invites_router = APIRouter()


def _require_same_server(member: Member, server_id: RecordId) -> None:
    if member.server_id != server_id:
        from core.api.errors import PermissionDeniedError

        raise PermissionDeniedError(
            "This token belongs to another server.",
            code="wrong_server",
            extra={"server_id": str(server_id)},
        )


ServerId = Annotated[RecordId, Path(description="Server identifier")]
InviteCode = Annotated[str, Path(min_length=4, max_length=32, description="Invite code")]
QueryLimit = Annotated[int, Query(ge=1, le=100, description="Max servers per page")]
QueryOffset = Annotated[int, Query(ge=0, description="How many servers to skip")]


@router.post(
    "",
    response_model=ServerRead,
    status_code=status.HTTP_201_CREATED,
    summary="Deploy a server",
)
async def create_server(
    payload: ServerCreate,
    session: SessionDep,
    request: Request,
    _admin: AdminAuth,
) -> ServerRead:
    supervisor = node_service.supervisor_from(request)
    server = await node_service.create_group(session, supervisor, payload)
    await queue_event(
        session,
        event_type="server.state_changed",
        server_id=server.id,
        data={"server_id": str(server.id), "status": server.status.value},
    )
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
    server_id: ServerId,
    payload: ServerUpdate,
    session: SessionDep,
    _admin: AdminAuth,
) -> ServerRead:
    server = await repository.get_server(session, server_id)
    updated = await repository.update_server(session, server, payload)
    data = ServerRead.model_validate(updated).model_dump(mode="json")
    await queue_event(
        session,
        event_type="server.updated",
        server_id=updated.id,
        data=data,
    )
    await service.record_audit(
        session,
        server_id=updated.id,
        actor_nickname="admin",
        action="server.updated",
        target_type="server",
        target_id=str(updated.id),
    )
    return ServerRead.model_validate(updated)


@router.post(
    "/{server_id}/activate",
    response_model=ServerRead,
    summary="Activate the server",
)
async def activate_server(
    server_id: ServerId,
    session: SessionDep,
    _admin: AdminAuth,
) -> ServerRead:
    server = await repository.get_server(session, server_id)
    activated = await service.activate_server(session, server)
    await queue_event(
        session,
        event_type="server.state_changed",
        server_id=activated.id,
        data={"server_id": str(activated.id), "status": activated.status.value},
    )
    await service.record_audit(
        session,
        server_id=activated.id,
        actor_nickname="admin",
        action="server.activated",
        target_type="server",
        target_id=str(activated.id),
    )
    return ServerRead.model_validate(activated)


@router.post(
    "/{server_id}/deactivate",
    response_model=ServerRead,
    summary="Deactivate the server",
)
async def deactivate_server(
    server_id: ServerId,
    session: SessionDep,
    _admin: AdminAuth,
) -> ServerRead:
    server = await repository.get_server(session, server_id)
    deactivated = await service.deactivate_server(session, server)
    await queue_event(
        session,
        event_type="server.state_changed",
        server_id=deactivated.id,
        data={"server_id": str(deactivated.id), "status": deactivated.status.value},
    )
    await service.record_audit(
        session,
        server_id=deactivated.id,
        actor_nickname="admin",
        action="server.deactivated",
        target_type="server",
        target_id=str(deactivated.id),
    )
    return ServerRead.model_validate(deactivated)


@router.post(
    "/{server_id}/heartbeat",
    response_model=ServerRead,
    summary="Report the process is still alive",
)
async def heartbeat(
    server_id: ServerId,
    session: SessionDep,
    _admin: AdminAuth,
) -> ServerRead:
    server = await repository.get_server(session, server_id)
    beat = await repository.heartbeat(session, server)
    return ServerRead.model_validate(beat)


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete the server",
)
async def delete_server(
    server_id: ServerId,
    session: SessionDep,
    _admin: AdminAuth,
) -> None:
    server = await repository.get_server(session, server_id)
    await service.delete_server(session, server)
    await service.record_audit(
        session,
        server_id=server_id,
        actor_nickname="admin",
        action="server.deleted",
        target_type="server",
        target_id=str(server_id),
    )
    await queue_event(
        session,
        event_type="server.state_changed",
        server_id=server_id,
        data={"server_id": str(server_id), "status": "deleted"},
    )


@router.get(
    "/{server_id}/address",
    response_model=ServerAddress,
    summary="Shareable address",
)
async def get_address(server_id: ServerId, session: SessionDep) -> ServerAddress:
    server = await repository.get_server(session, server_id)
    node = NodeAddress.model_validate(node_service.node_address())
    return ServerAddress.from_server(server, node)


@router.post(
    "/{server_id}/invites",
    response_model=InviteRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create an invite",
)
async def create_invite(
    server_id: ServerId,
    payload: InviteCreate,
    member: CurrentMember,
    session: SessionDep,
) -> InviteRead:
    server = await repository.get_server(session, server_id)
    service.ensure_member_of(member, server_id)
    invite = await service.create_invite(session, server, member, payload)
    return InviteRead.model_validate(invite)


@router.get("/invites/{code}", response_model=InviteRead, summary="See an invite")
async def get_invite(code: InviteCode, session: SessionDep) -> InviteRead:
    invite = await service.get_invite(session, code)
    return InviteRead.model_validate(invite)


@router.delete(
    "/invites/{code}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an invite",
)
async def delete_invite(code: InviteCode, session: SessionDep) -> None:
    await service.delete_invite(session, code)
