"""Identity API contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from apps.common import nickname as nick
from apps.identity.roles import Role

Nickname = Annotated[str, Field(min_length=nick.MIN_LENGTH, max_length=nick.MAX_LENGTH)]
DisplayName = Annotated[str, Field(min_length=1, max_length=64)]


class JoinRequest(BaseModel):
    """Join a server with just a nickname; no email/password."""

    nickname: Nickname
    display_name: DisplayName | None = None
    """Visible name; defaults to capitalized nickname."""

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
            raise ValueError("el nombre visible no puede estar vacío")
        return cleaned


class MemberRead(BaseModel):
    """Server member; exposes no secrets."""

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
        """Serialize role as text label, not int."""
        return role.label


class MemberListResponse(BaseModel):
    """Paginated member list."""

    items: list[MemberRead]
    total: int
    limit: int
    offset: int


class JoinResponse(BaseModel):
    """Join result; token is shown only once."""

    token: str
    """Opaque session token scoped to this server."""

    expires_at: datetime | None
    """Expiry; None means valid until revoked."""

    member: MemberRead
    server: ServerSummary


class ServerSummary(BaseModel):
    """Minimal server data for responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    slug: str
    name: str


class MeResponse(BaseModel):
    """Caller identity within this token's server."""

    member: MemberRead
    server: ServerSummary


class MeUpdate(BaseModel):
    """Change own display name."""

    display_name: DisplayName

    @field_validator("display_name")
    @classmethod
    def _clean(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("el nombre visible no puede estar vacío")
        return cleaned


class TokenResponse(BaseModel):
    """A fresh token."""

    token: str
    expires_at: datetime | None
