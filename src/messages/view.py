from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query
from sqlalchemy import select

from channels.model import Channel
from common.types import RecordId
from core.api.deps import SessionDep
from messages import repository
from messages.schemas import MessageCreate, MessageListResponse, MessageRead
from servers import repository as servers_repository

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Server identifier")]
ChannelId = Annotated[RecordId, Path(description="Channel identifier")]
QueryLimit = Annotated[int, Query(ge=1, le=100)]
QueryOffset = Annotated[int, Query(ge=0)]


@router.post(
    "/{server_id}/channels/{channel_id}/messages",
    response_model=MessageRead,
    summary="Send a text message",
)
async def create_message(
    server_id: ServerId,
    channel_id: ChannelId,
    payload: MessageCreate,
    session: SessionDep,
) -> MessageRead:
    server = await servers_repository.get_server(session, server_id)
    stmt = select(Channel).where(Channel.id == channel_id, Channel.server_id == server.id)
    (await session.execute(stmt)).scalar_one()
    message = await repository.create_message(
        session, channel_id=channel_id, author_nickname="anon", content=payload.content
    )
    return MessageRead.model_validate(message)


@router.get(
    "/{server_id}/channels/{channel_id}/messages",
    response_model=MessageListResponse,
    summary="List channel messages",
)
async def list_messages(
    session: SessionDep,
    server_id: ServerId,
    channel_id: ChannelId,
    limit: QueryLimit = 50,
    offset: QueryOffset = 0,
) -> MessageListResponse:
    await servers_repository.get_server(session, server_id)
    messages, total = await repository.list_messages(session, channel_id, limit=limit, offset=offset)
    return MessageListResponse(
        items=[MessageRead.model_validate(m) for m in messages],
        total=total,
        limit=limit,
        offset=offset,
    )
