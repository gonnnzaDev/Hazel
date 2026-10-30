from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, status

from channels import service
from channels.model import Channel
from channels.schemas import ChannelCreate, ChannelRead, ChannelUpdate
from common.types import RecordId
from core.api.deps import SessionDep
from core.api.errors import PermissionDeniedError
from identity.deps import CurrentMember
from identity.model import Member
from servers import service as servers_service

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Server identifier")]
ChannelId = Annotated[RecordId, Path(description="Channel identifier")]


def _require_same_server(member: Member, server_id: RecordId) -> None:
    if member.server_id != server_id:
        raise PermissionDeniedError(
            "This token belongs to another server.",
            code="wrong_server",
            extra={"server_id": str(server_id)},
        )


@router.post(
    "/{server_id}/channels",
    response_model=ChannelRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a channel",
)
async def create_channel(
    server_id: ServerId,
    payload: ChannelCreate,
    member: CurrentMember,
    session: SessionDep,
) -> Channel:
    _require_same_server(member, server_id)
    service.ensure_can_manage_channels(member)
    channel = await service.create_channel(session, server_id, payload)
    await servers_service.record_audit(
        session,
        server_id=server_id,
        actor_nickname=member.nickname,
        action="channel.created",
        target_type="channel",
        target_id=str(channel.id),
        data={"name": channel.name},
    )
    return channel


@router.get(
    "/{server_id}/channels",
    response_model=list[ChannelRead],
    summary="List channels",
)
async def list_channels(
    server_id: ServerId,
    member: CurrentMember,
    session: SessionDep,
) -> list[Channel]:
    _require_same_server(member, server_id)
    return await service.list_channels(session, server_id)


@router.get(
    "/{server_id}/channels/{channel_id}",
    response_model=ChannelRead,
    summary="Get a channel",
)
async def get_channel(
    server_id: ServerId,
    channel_id: ChannelId,
    member: CurrentMember,
    session: SessionDep,
) -> Channel:
    _require_same_server(member, server_id)
    return await service.get_channel(session, server_id, channel_id)


@router.post(
    "/{server_id}/channels/{channel_id}/join",
    response_model=ChannelRead,
    summary="Join a channel",
)
async def join_channel(
    server_id: ServerId,
    channel_id: ChannelId,
    member: CurrentMember,
    session: SessionDep,
) -> Channel:
    _require_same_server(member, server_id)
    return await service.get_channel(session, server_id, channel_id)


@router.patch(
    "/{server_id}/channels/{channel_id}",
    response_model=ChannelRead,
    summary="Edit a channel",
)
async def update_channel(
    server_id: ServerId,
    channel_id: ChannelId,
    payload: ChannelUpdate,
    member: CurrentMember,
    session: SessionDep,
) -> Channel:
    _require_same_server(member, server_id)
    service.ensure_can_manage_channels(member)
    channel = await service.get_channel(session, server_id, channel_id)
    updated = await service.update_channel(session, channel, payload)
    await servers_service.record_audit(
        session,
        server_id=server_id,
        actor_nickname=member.nickname,
        action="channel.updated",
        target_type="channel",
        target_id=str(updated.id),
    )
    return updated


@router.delete(
    "/{server_id}/channels/{channel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a channel",
)
async def delete_channel(
    server_id: ServerId,
    channel_id: ChannelId,
    member: CurrentMember,
    session: SessionDep,
) -> None:
    _require_same_server(member, server_id)
    service.ensure_can_manage_channels(member)
    channel = await service.get_channel(session, server_id, channel_id)
    await service.delete_channel(session, channel)
    await servers_service.record_audit(
        session,
        server_id=server_id,
        actor_nickname=member.nickname,
        action="channel.deleted",
        target_type="channel",
        target_id=str(channel_id),
    )
