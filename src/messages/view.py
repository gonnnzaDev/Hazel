from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, Path, Query, Response, UploadFile, status

from channels.model import Channel
from common.types import RecordId
from core.api.deps import SessionDep, SettingsDep
from core.api.errors import NotFoundError
from identity.deps import CurrentMember
from messages import repository, service
from messages.schemas import (
    AttachmentRead,
    MessageCreate,
    MessageListResponse,
    MessageRead,
    MessageUpdate,
    ReactionCreate,
)
from servers import service as servers_service

router = APIRouter()

ChannelId = Annotated[RecordId, Path(description="Channel identifier")]
MessageId = Annotated[RecordId, Path(description="Message identifier")]
AttachmentId = Annotated[RecordId, Path(description="Attachment identifier")]
AttachmentMessageId = Annotated[RecordId, Form()]
QueryLimit = Annotated[int, Query(ge=1, le=100, description="Max messages per page")]
QueryBefore = Annotated[RecordId | None, Query(description="Return messages older than this id")]


@router.post(
    "/channels/{channel_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Publish a message",
)
async def create_message(
    channel_id: ChannelId,
    payload: MessageCreate,
    member: CurrentMember,
    session: SessionDep,
    settings: SettingsDep,
) -> MessageRead:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    result = await service.create_message(session, member, channel, payload, settings)
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="message.created",
        target_type="message",
        target_id=str(result.id),
        data={"channel_id": str(channel_id)},
    )
    return result


@router.get(
    "/channels/{channel_id}/messages",
    response_model=MessageListResponse,
    summary="Channel history",
)
async def list_messages(
    channel_id: ChannelId,
    member: CurrentMember,
    session: SessionDep,
    limit: QueryLimit = 50,
    before: QueryBefore = None,
) -> MessageListResponse:
    channel: Channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    messages = await service.list_messages(
        session,
        member,
        channel,
        limit=limit,
        before=before,
    )
    next_cursor = messages[-1].id if len(messages) == limit else None
    return MessageListResponse(items=messages, limit=limit, next_cursor=next_cursor)


@router.get(
    "/channels/{channel_id}/messages/{message_id}",
    response_model=MessageRead,
    summary="See one message",
)
async def get_message(
    channel_id: ChannelId,
    message_id: MessageId,
    member: CurrentMember,
    session: SessionDep,
) -> MessageRead:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    return await service.get_message(session, member, channel, message_id)


@router.patch(
    "/channels/{channel_id}/messages/{message_id}",
    response_model=MessageRead,
    summary="Edit a message",
)
async def edit_message(
    channel_id: ChannelId,
    message_id: MessageId,
    payload: MessageUpdate,
    member: CurrentMember,
    session: SessionDep,
    settings: SettingsDep,
) -> MessageRead:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    result = await service.edit_message(session, member, channel, message_id, payload, settings)
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="message.updated",
        target_type="message",
        target_id=str(message_id),
    )
    return result


@router.delete(
    "/channels/{channel_id}/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a message",
)
async def delete_message(
    channel_id: ChannelId,
    message_id: MessageId,
    member: CurrentMember,
    session: SessionDep,
) -> None:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    await service.delete_message(session, member, channel, message_id)
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="message.deleted",
        target_type="message",
        target_id=str(message_id),
    )


@router.post(
    "/channels/{channel_id}/messages/{message_id}/reactions",
    response_model=MessageRead,
    status_code=status.HTTP_200_OK,
    summary="React to a message",
)
async def add_reaction(
    channel_id: ChannelId,
    message_id: MessageId,
    payload: ReactionCreate,
    member: CurrentMember,
    session: SessionDep,
) -> MessageRead:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    result = await service.add_reaction(session, member, channel, message_id, payload.emoji)
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="reaction.added",
        target_type="message",
        target_id=str(message_id),
        data={"emoji": payload.emoji},
    )
    return result


@router.delete(
    "/channels/{channel_id}/messages/{message_id}/reactions/{emoji}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove my reaction",
)
async def remove_reaction(
    channel_id: ChannelId,
    message_id: MessageId,
    emoji: Annotated[str, Path(min_length=1, max_length=64)],
    member: CurrentMember,
    session: SessionDep,
) -> None:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    await service.remove_reaction(session, member, channel, message_id, emoji)
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="reaction.removed",
        target_type="message",
        target_id=str(message_id),
        data={"emoji": emoji},
    )


@router.post(
    "/channels/{channel_id}/attachments",
    response_model=AttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an attachment",
)
async def create_attachment(
    channel_id: ChannelId,
    attachment_message_id: AttachmentMessageId,
    file: Annotated[UploadFile, File()],
    member: CurrentMember,
    session: SessionDep,
) -> AttachmentRead:
    channel = await service.get_reachable_channel(session, member.server_id, channel_id)
    attachment = await service.create_attachment(
        session,
        member,
        channel,
        attachment_message_id,
        filename=file.filename or "attachment",
        content_type=file.content_type or "application/octet-stream",
        data=await file.read(),
    )
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="attachment.uploaded",
        target_type="attachment",
        target_id=str(attachment.id),
        data={"message_id": str(attachment.message_id)},
    )
    return AttachmentRead(
        id=attachment.id,
        message_id=attachment.message_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size=attachment.size,
        storage_key=attachment.storage_key,
    )


@router.get(
    "/attachments/{attachment_id}",
    summary="Download an attachment",
)
async def get_attachment(
    attachment_id: AttachmentId,
    member: CurrentMember,
    session: SessionDep,
) -> Response:
    attachment = await service.get_attachment(session, attachment_id)
    if attachment is None:
        raise NotFoundError(
            "That attachment does not exist.",
            code="attachment_not_found",
            extra={"attachment_id": str(attachment_id)},
        )
    message = await repository.get_message(session, attachment.message_id)
    if message is None:
        raise NotFoundError(
            "That message does not exist.",
            code="message_not_found",
            extra={"message_id": str(attachment.message_id)},
        )
    channel = await repository.get_channel_scoped(session, member.server_id, message.channel_id)
    if channel is None:
        raise NotFoundError(
            "That attachment does not exist.",
            code="attachment_not_found",
            extra={"attachment_id": str(attachment_id)},
        )
    return Response(
        content=service.read_attachment(attachment),
        media_type=attachment.content_type,
        headers={"Content-Disposition": f'attachment; filename="{attachment.filename}"'},
    )


@router.delete(
    "/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an attachment",
)
async def delete_attachment(
    attachment_id: AttachmentId,
    member: CurrentMember,
    session: SessionDep,
) -> None:
    await service.delete_attachment(session, member, attachment_id)
    await servers_service.record_audit(
        session,
        server_id=member.server_id,
        actor_nickname=member.nickname,
        action="attachment.deleted",
        target_type="attachment",
        target_id=str(attachment_id),
    )
