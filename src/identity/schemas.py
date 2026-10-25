from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from common import nickname as nick
from identity.roles import Role

Nickname = Annotated[str, Field(min_length=nick.MIN_LENGTH, max_length=nick.MAX_LENGTH)]
DisplayName = Annotated[str, Field(min_length=1, max_length=64)]


class JoinRequest(BaseModel):
    nickname: Nickname
    display_name: DisplayName | None = None

    @field_validator("nickname")
    @classmethod
    def _valid_nickname(cls, value: str) -> str:
        return nick.validate(value)

    @field_validator("display_name")
    @classmethod
    def _clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("display name cannot be empty")
        return cleaned


class MemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    nickname: str
    display_name: str
    role: Role
    is_online: bool
    last_seen_at: datetime | None
    joined_at: datetime

    @field_serializer("role")
    def _serialize_role(self, role: Role) -> str:
        return role.label


class MemberListResponse(BaseModel):
    items: list[MemberRead]
    total: int
    limit: int
    offset: int


class JoinResponse(BaseModel):
    token: str

    expires_at: datetime | None

    member: MemberRead
    server: ServerSummary


class ServerSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    slug: str
    name: str


class MeResponse(BaseModel):
    member: MemberRead
    server: ServerSummary


class MeUpdate(BaseModel):
    display_name: DisplayName

    @field_validator("display_name")
    @classmethod
    def _clean(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("display name cannot be empty")
        return cleaned


class TokenResponse(BaseModel):
    token: str
    expires_at: datetime | None
