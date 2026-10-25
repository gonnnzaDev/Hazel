from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from channels.model import Channel
from common.types import RecordId
from core.api.deps import SessionDep, SettingsDep
from identity.deps import CurrentMember
from messages import service
from messages.schemas import (
    MessageCreate,
    MessageListResponse,
    MessageRead,
    MessageUpdate,
    ReactionCreate,
)

router = APIRouter()

ChannelId = Annotated[RecordId, Path(description="Channel identifier")]
MessageId = Annotated[RecordId, Path(description="Message identifier")]
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
    return await service.create_message(session, member, channel, payload, settings)


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
    return await service.edit_message(session, member, channel, message_id, payload, settings)


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
    return await service.add_reaction(session, member, channel, message_id, payload.emoji)


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
