from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.types import RecordId, new_id
from messages.model import Message

logger = logging.getLogger(__name__)


async def create_message(
    session: AsyncSession, channel_id: RecordId, author_nickname: str, content: str
) -> Message:
    message = Message(
        id=new_id(),
        channel_id=channel_id,
        author_nickname=author_nickname,
        content=content,
    )
    session.add(message)
    await session.flush()
    logger.info("message recorded channel=%s nick=%s", channel_id, author_nickname)
    return message


async def list_messages(
    session: AsyncSession, channel_id: RecordId, limit: int = 50, offset: int = 0
) -> tuple[list[Message], int]:
    total = (
        await session.execute(
            select(func.count()).select_from(Message).where(Message.channel_id == channel_id)
        )
    ).scalar_one()
    stmt = (
        select(Message)
        .where(Message.channel_id == channel_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    messages = (await session.execute(stmt)).scalars().all()
    return list(messages), int(total)
