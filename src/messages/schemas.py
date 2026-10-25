from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from common.types import RecordId


class MessageAuthorRead(BaseModel):
    nickname: str
    display_name: str | None


class ReactionRead(BaseModel):
    emoji: str
    nickname: str


class MessageRead(BaseModel):
    id: RecordId
    channel_id: RecordId
    author: MessageAuthorRead
    content: str | None
    reply_to: RecordId | None
    attachments: list[str] = Field(default_factory=list)
    reactions: list[ReactionRead] = Field(default_factory=list)
    created_at: datetime
    edited_at: datetime | None
    deleted: bool


class MessageCreate(BaseModel):
    content: Annotated[str, Field(min_length=1)]
    reply_to: RecordId | None = None
    attachments: Annotated[list[str], Field(max_length=0)] = []


class MessageUpdate(BaseModel):
    content: Annotated[str, Field(min_length=1)] | None = None


class MessageListResponse(BaseModel):
    items: list[MessageRead]
    limit: int
    next_cursor: RecordId | None


class ReactionCreate(BaseModel):
    emoji: Annotated[str, Field(min_length=1, max_length=64)]
