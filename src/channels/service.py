from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from channels import repository
from channels.model import Channel
from channels.schemas import ChannelCreate
from common.types import new_id

logger = logging.getLogger(__name__)


async def create_channels_for_server(
    session: AsyncSession, server_id: str, payload_channels: list[ChannelCreate]
) -> list[Channel]:
    channels = repository.build_channels(payload_channels)
    repository.ensure_default_channel(channels)
    for channel in channels:
        channel.server_id = server_id
        session.add(channel)
    await session.flush()
    return channels
