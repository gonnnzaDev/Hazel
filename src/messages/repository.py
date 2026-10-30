from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from channels.model import Channel
from common.types import RecordId, new_id
from messages.model import Attachment, Message, Reaction

logger = logging.getLogger(__name__)


async def get_channel_scoped(
    session: AsyncSession, server_id: RecordId, channel_id: RecordId
) -> Channel | None:
    stmt = (
        select(Channel)
        .options(selectinload(Channel.server))
        .where(Channel.id == channel_id, Channel.server_id == server_id)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def create_message(
    session: AsyncSession,
    *,
    channel_id: RecordId,
    author_member_id: RecordId | None,
    author_nickname: str,
    content: str,
    reply_to: RecordId | None,
    attachments: list[str],
) -> Message:
    message = Message(
        id=new_id(),
        channel_id=channel_id,
        author_member_id=author_member_id,
        author_nickname=author_nickname,
        content=content,
        reply_to=reply_to,
        attachments=attachments,
    )
    session.add(message)
    await session.flush()
    logger.info("message recorded channel=%s nick=%s", channel_id, author_nickname)
    return message


async def get_message(session: AsyncSession, message_id: RecordId) -> Message | None:
    stmt = select(Message).where(Message.id == message_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_reply_target(
    session: AsyncSession, channel_id: RecordId, reply_to: RecordId
) -> Message | None:
    stmt = select(Message).where(Message.id == reply_to, Message.channel_id == channel_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def list_for_channel(
    session: AsyncSession,
    channel_id: RecordId,
    *,
    limit: int,
    before: RecordId | None = None,
) -> list[Message]:
    stmt = select(Message).where(Message.channel_id == channel_id)
    if before is not None:
        stmt = stmt.where(Message.id < before)
    stmt = stmt.order_by(Message.id.desc()).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def count_recent_by_member(
    session: AsyncSession, member_id: RecordId, window_start: datetime
) -> int:
    stmt = (
        select(func.count())
        .select_from(Message)
        .where(Message.author_member_id == member_id, Message.created_at >= window_start)
    )
    return int((await session.execute(stmt)).scalar_one())


async def soft_delete(session: AsyncSession, message: Message, *, at: datetime) -> Message:
    message.deleted_at = at
    await session.flush()
    return message


async def add_reaction(
    session: AsyncSession, message: Message, member_id: RecordId, emoji: str
) -> Reaction:
    existing = (
        await session.execute(
            select(Reaction).where(
                Reaction.message_id == message.id,
                Reaction.member_id == member_id,
                Reaction.emoji == emoji,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    reaction = Reaction(
        id=new_id(),
        message_id=message.id,
        member_id=member_id,
        emoji=emoji,
    )
    session.add(reaction)
    await session.flush()
    return reaction


async def remove_reaction(
    session: AsyncSession, message: Message, member_id: RecordId, emoji: str
) -> bool:
    reaction = (
        await session.execute(
            select(Reaction).where(
                Reaction.message_id == message.id,
                Reaction.member_id == member_id,
                Reaction.emoji == emoji,
            )
        )
    ).scalar_one_or_none()
    if reaction is None:
        return False
    await session.delete(reaction)
    await session.flush()
    return True


async def list_reactions(session: AsyncSession, message_id: RecordId) -> list[tuple[str, str]]:
    from identity.model import Member

    stmt = (
        select(Reaction.emoji, Member.nickname)
        .join(Member, Member.id == Reaction.member_id)
        .where(Reaction.message_id == message_id)
        .order_by(Reaction.created_at, Reaction.emoji)
    )
    rows = (await session.execute(stmt)).all()
    return [(row.emoji, row.nickname) for row in rows]


async def list_reactions_batch(
    session: AsyncSession, message_ids: list[RecordId]
) -> dict[RecordId, list[tuple[str, str]]]:
    if not message_ids:
        return {}

    from identity.model import Member

    stmt = (
        select(Reaction.message_id, Reaction.emoji, Member.nickname)
        .join(Member, Member.id == Reaction.member_id)
        .where(Reaction.message_id.in_(message_ids))
        .order_by(Reaction.created_at, Reaction.emoji)
    )
    grouped: dict[RecordId, list[tuple[str, str]]] = {}
    for row in (await session.execute(stmt)).all():
        grouped.setdefault(row.message_id, []).append((row.emoji, row.nickname))
    return grouped


async def get_display_names(
    session: AsyncSession, member_ids: list[RecordId]
) -> dict[RecordId, str | None]:
    from identity.model import Member

    if not member_ids:
        return {}

    stmt = select(Member.id, Member.display_name).where(Member.id.in_(member_ids))
    rows = (await session.execute(stmt)).all()
    return {row.id: row.display_name for row in rows}


async def create_attachment(
    session: AsyncSession,
    *,
    message_id: RecordId,
    filename: str,
    content_type: str,
    size: int,
    storage_key: str,
) -> Attachment:
    attachment = Attachment(
        id=new_id(),
        message_id=message_id,
        filename=filename,
        content_type=content_type,
        size=size,
        storage_key=storage_key,
    )
    session.add(attachment)
    await session.flush()
    return attachment


async def get_attachment(session: AsyncSession, attachment_id: RecordId) -> Attachment | None:
    return (
        await session.execute(select(Attachment).where(Attachment.id == attachment_id))
    ).scalar_one_or_none()


async def delete_attachment(session: AsyncSession, attachment: Attachment) -> None:
    await session.delete(attachment)
