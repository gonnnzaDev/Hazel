from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from channels import repository
from channels.model import Channel
from channels.schemas import ChannelCreate, ChannelUpdate
from common.types import RecordId
from core.api.errors import ConflictError, PermissionDeniedError
from identity.model import Member

logger = logging.getLogger(__name__)


def ensure_can_manage_channels(member: Member) -> None:
    if not member.role_enum.can_administer:
        raise PermissionDeniedError(
            "You must be an administrator to manage channels.",
            code="not_admin",
        )


async def list_channels(session: AsyncSession, server_id: RecordId) -> list[Channel]:
    return await repository.list_for_server(session, server_id)


async def get_channel(session: AsyncSession, server_id: RecordId, channel_id: RecordId) -> Channel:
    return await repository.get_for_server(session, server_id, channel_id)


async def create_channel(
    session: AsyncSession, server_id: RecordId, payload: ChannelCreate
) -> Channel:
    if await repository.name_taken(session, server_id, payload.name):
        raise ConflictError(
            f"Channel '{payload.name}' already exists in this server.",
            code="channel_name_taken",
            extra={"name": payload.name},
        )

    position = payload.position
    if position is None:
        position = await repository.next_position(session, server_id)

    channel = Channel(
        server_id=server_id,
        name=payload.name,
        kind=payload.kind,
        topic=payload.topic,
        position=position,
        is_default=False,
    )
    session.add(channel)
    await session.flush()

    logger.info("channel created server=%s name=%s", server_id, channel.name)
    return channel


async def update_channel(
    session: AsyncSession, channel: Channel, payload: ChannelUpdate
) -> Channel:
    if payload.name is not None and await repository.name_taken(
        session, channel.server_id, payload.name, exclude=channel.id
    ):
        raise ConflictError(
            f"Channel '{payload.name}' already exists in this server.",
            code="channel_name_taken",
            extra={"name": payload.name},
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(channel, field, value)
    await session.flush()
    return channel


async def delete_channel(session: AsyncSession, channel: Channel) -> None:
    if channel.is_default:
        raise ConflictError(
            "The default channel cannot be deleted.",
            code="default_channel",
        )

    name = channel.name
    await session.delete(channel)
    logger.info("channel deleted server=%s name=%s", channel.server_id, name)
