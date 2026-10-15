from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from common.types import RecordId


class ChannelBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=64)]
    kind: str = "text"
    topic: Annotated[str | None, Field(default=None, max_length=255)]
    position: int = Field(default=0, ge=0)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("channel name cannot be empty")
        return normalized


class ChannelCreate(ChannelBase):
    is_default: bool = False

    @field_validator("kind", mode="after")
    @classmethod
    def validar_kind(cls, value):
        if value not in ["text", "voice"]:
            raise ValueError(f"'{value}' is not a valid kind. Use 'text' or 'voice'.")
        return value


class ChannelRead(ChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    server_id: RecordId
    is_default: bool
    live_room_id: str | None = None
