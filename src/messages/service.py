from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from channels.model import Channel
from common.types import RecordId, utcnow
from config.conf import Settings
from core.api.errors import (
    ConflictError,
    MessageTooLargeError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    ServerInactiveError,
    ValidationDomainError,
)
from identity.model import Member
from messages import repository
from messages.model import Message
from messages.schemas import (
    MessageAuthorRead,
    MessageCreate,
    MessageRead,
    MessageUpdate,
    ReactionRead,
)

logger = logging.getLogger(__name__)

RATE_WINDOW = timedelta(seconds=60)


async def get_reachable_channel(
    session: AsyncSession, server_id: RecordId, channel_id: RecordId
) -> Channel:
    channel = await repository.get_channel_scoped(session, server_id, channel_id)
    if channel is None:
        raise NotFoundError(
            "That channel does not exist in this server.",
            code="channel_not_found",
            extra={"channel_id": str(channel_id)},
        )
    if not channel.server.status.accepts_traffic:
        raise ServerInactiveError(
            "Server is inactive. It accepts no connections until its owner activates it again.",
            extra={"server_id": str(channel.server.id)},
        )
    return channel


def _can_touch_authorship(member: Member, message: Message) -> bool:
    if message.author_member_id is not None:
        return message.author_member_id == member.id
    return message.author_nickname == member.nickname


def _enforce_size(content: str, settings: Settings) -> None:
    size = len(content.encode("utf-8"))
    if size > settings.max_message_bytes:
        raise MessageTooLargeError(
            f"Message is {size} bytes; the limit is {settings.max_message_bytes}.",
            extra={"max_message_bytes": settings.max_message_bytes},
        )


def build_read(
    message: Message,
    display_name: str | None,
    reactions: list[tuple[str, str]],
) -> MessageRead:
    return MessageRead(
        id=message.id,
        channel_id=message.channel_id,
        author=MessageAuthorRead(nickname=message.author_nickname, display_name=display_name),
        content=None if message.deleted_at else message.content,
        reply_to=message.reply_to,
        attachments=[str(a) for a in message.attachments],
        reactions=[ReactionRead(emoji=emoji, nickname=nickname) for emoji, nickname in reactions],
        created_at=message.created_at,
        edited_at=message.edited_at,
        deleted=message.deleted_at is not None,
    )


async def _reads(session: AsyncSession, messages: list[Message]) -> list[MessageRead]:
    ids = [message.id for message in messages]
    display = await repository.get_display_names(
        session, [m.author_member_id for m in messages if m.author_member_id]
    )
    reactions = await repository.list_reactions_batch(session, ids)

    reads: list[MessageRead] = []
    for message in messages:
        reads.append(
            build_read(
                message,
                display.get(message.author_member_id) if message.author_member_id else None,
                reactions.get(message.id, []),
            )
        )
    return reads


async def list_messages(
    session: AsyncSession,
    member: Member,
    channel: Channel,
    *,
    limit: int,
    before: RecordId | None,
) -> list[MessageRead]:
    messages = await repository.list_for_channel(
        session,
        channel.id,
        limit=limit,
        before=before,
    )
    return await _reads(session, messages)


async def get_message(
    session: AsyncSession, member: Member, channel: Channel, message_id: RecordId
) -> MessageRead:
    message = await repository.get_message(session, message_id)
    if message is None or message.channel_id != channel.id:
        raise NotFoundError(
            "That message does not exist in this channel.",
            code="message_not_found",
            extra={"message_id": str(message_id)},
        )
    reactions = await repository.list_reactions(session, message.id)
    display = (
        await repository.get_display_names(session, [message.author_member_id])
        if message.author_member_id
        else {}
    )
    return build_read(
        message,
        display.get(message.author_member_id) if message.author_member_id else None,
        reactions,
    )


async def create_message(
    session: AsyncSession,
    member: Member,
    channel: Channel,
    payload: MessageCreate,
    settings: Settings,
) -> MessageRead:
    _enforce_size(payload.content, settings)

    recent = await repository.count_recent_by_member(
        session,
        member.id,
        utcnow() - RATE_WINDOW,
    )
    if recent >= settings.rate_limit_messages_per_minute:
        raise RateLimitError(
            f"Only {settings.rate_limit_messages_per_minute} messages per minute per nickname.",
            extra={"limit": settings.rate_limit_messages_per_minute},
        )

    reply_to: RecordId | None = None
    if payload.reply_to is not None:
        target = await repository.get_reply_target(session, channel.id, payload.reply_to)
        if target is None:
            raise ValidationDomainError(
                "The message you reply to must exist in the same channel.",
                code="reply_target_invalid",
                extra={"reply_to": str(payload.reply_to)},
            )
        if target.deleted_at is not None:
            raise ValidationDomainError(
                "You cannot reply to a deleted message.",
                code="reply_target_deleted",
                extra={"reply_to": str(payload.reply_to)},
            )
        reply_to = payload.reply_to

    message = await repository.create_message(
        session,
        channel_id=channel.id,
        author_member_id=member.id,
        author_nickname=member.nickname,
        content=payload.content,
        reply_to=reply_to,
        attachments=list(payload.attachments),
    )
    reads = await _reads(session, [message])
    return reads[0]


async def edit_message(
    session: AsyncSession,
    member: Member,
    channel: Channel,
    message_id: RecordId,
    payload: MessageUpdate,
    settings: Settings,
) -> MessageRead:
    message = await repository.get_message(session, message_id)
    if message is None or message.channel_id != channel.id:
        raise NotFoundError(
            "That message does not exist in this channel.",
            code="message_not_found",
            extra={"message_id": str(message_id)},
        )
    if message.deleted_at is not None:
        raise ConflictError(
            "Deleted messages cannot be edited.",
            code="message_deleted",
            extra={"message_id": str(message.id)},
        )
    if payload.content is None:
        raise ValidationDomainError(
            "Provide content to edit.",
            code="validation_error",
        )
    if not _can_touch_authorship(member, message):
        raise PermissionDeniedError(
            "Only the author can edit a message.",
            code="not_message_author",
        )

    _enforce_size(payload.content, settings)

    message.content = payload.content
    message.edited_at = utcnow()
    await session.flush()

    return await get_message(session, member, channel, message.id)


async def delete_message(
    session: AsyncSession, member: Member, channel: Channel, message_id: RecordId
) -> None:
    message = await repository.get_message(session, message_id)
    if message is None or message.channel_id != channel.id:
        raise NotFoundError(
            "That message does not exist in this channel.",
            code="message_not_found",
            extra={"message_id": str(message_id)},
        )
    if message.deleted_at is not None:
        raise ConflictError(
            "The message is already deleted.",
            code="message_deleted",
            extra={"message_id": str(message.id)},
        )
    if not (_can_touch_authorship(member, message) or member.role_enum.can_administer):
        raise PermissionDeniedError(
            "Only the author or an administrator can delete a message.",
            code="not_message_author",
        )

    await repository.soft_delete(session, message, at=utcnow())
    logger.info("message deleted channel=%s id=%s", channel.id, message.id)


async def add_reaction(
    session: AsyncSession, member: Member, channel: Channel, message_id: RecordId, emoji: str
) -> MessageRead:
    message = await repository.get_message(session, message_id)
    if message is None or message.channel_id != channel.id:
        raise NotFoundError(
            "That message does not exist in this channel.",
            code="message_not_found",
            extra={"message_id": str(message_id)},
        )
    if message.deleted_at is not None:
        raise ConflictError(
            "Deleted messages cannot be reacted to.",
            code="message_deleted",
            extra={"message_id": str(message.id)},
        )

    await repository.add_reaction(session, message, member.id, emoji)
    return await get_message(session, member, channel, message.id)


async def remove_reaction(
    session: AsyncSession, member: Member, channel: Channel, message_id: RecordId, emoji: str
) -> None:
    message = await repository.get_message(session, message_id)
    if message is None or message.channel_id != channel.id:
        raise NotFoundError(
            "That message does not exist in this channel.",
            code="message_not_found",
            extra={"message_id": str(message_id)},
        )
    await repository.remove_reaction(session, message, member.id, emoji)
