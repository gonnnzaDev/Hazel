from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from channels.model import Channel, ChannelKind
from common.types import RecordId, new_id
from core.api.errors import NotFoundError

logger = logging.getLogger(__name__)

DEFAULT_CHANNEL_NAME = "general"
DEFAULT_CHANNEL_POSITION = 0


def default_channel() -> Channel:
    return Channel(
        id=new_id(),
        name=DEFAULT_CHANNEL_NAME,
        kind=ChannelKind.TEXT,
        topic=None,
        position=DEFAULT_CHANNEL_POSITION,
        is_default=True,
    )


async def list_for_server(session: AsyncSession, server_id: RecordId) -> list[Channel]:
    stmt = (
        select(Channel)
        .where(Channel.server_id == server_id)
        .order_by(Channel.position, Channel.name)
    )
    return list((await session.execute(stmt)).scalars().all())


async def get_for_server(
    session: AsyncSession, server_id: RecordId, channel_id: RecordId
) -> Channel:
    stmt = select(Channel).where(Channel.id == channel_id, Channel.server_id == server_id)
    channel = (await session.execute(stmt)).scalar_one_or_none()
    if channel is None:
        raise NotFoundError(
            "That channel does not exist in this server.",
            code="channel_not_found",
            extra={"channel_id": str(channel_id), "server_id": str(server_id)},
        )
    return channel


async def name_taken(
    session: AsyncSession,
    server_id: RecordId,
    name: str,
    *,
    exclude: RecordId | None = None,
) -> bool:
    stmt = (
        select(func.count())
        .select_from(Channel)
        .where(Channel.server_id == server_id, Channel.name == name)
    )
    if exclude is not None:
        stmt = stmt.where(Channel.id != exclude)
    return (await session.execute(stmt)).scalar_one() > 0


async def next_position(session: AsyncSession, server_id: RecordId) -> int:
    stmt = select(func.max(Channel.position)).where(Channel.server_id == server_id)
    max_position = (await session.execute(stmt)).scalar_one_or_none()
    return (max_position + 1) if max_position is not None else DEFAULT_CHANNEL_POSITION + 1
