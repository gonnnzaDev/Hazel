from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from common.types import RecordId


class MessageCreate(BaseModel):

    content: Annotated[str, Field(min_length=1, max_length=2000)]

    model_config = ConfigDict(from_attributes=True)


class MessageRead(BaseModel):

    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    author_nickname: str
    content: str
    created_at: datetime


class MessageListResponse(BaseModel):

    items: list[MessageRead]
    total: int
    limit: int
    offset: int
