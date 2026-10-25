from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from channels.model import ChannelKind
from common.types import RecordId


class ChannelBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=64)]
    kind: ChannelKind = ChannelKind.TEXT
    topic: Annotated[str | None, Field(default=None, max_length=255)]

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("channel name cannot be empty")
        return normalized


class ChannelCreate(ChannelBase):
    position: Annotated[int | None, Field(default=None, ge=0)]


class ChannelUpdate(BaseModel):
    name: Annotated[str | None, Field(default=None, min_length=1, max_length=64)]
    topic: Annotated[str | None, Field(default=None, max_length=255)]
    position: Annotated[int | None, Field(default=None, ge=0)]

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("channel name cannot be empty")
        return normalized


class ChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    server_id: RecordId
    name: str
    kind: ChannelKind
    topic: str | None
    position: int
    is_default: bool
