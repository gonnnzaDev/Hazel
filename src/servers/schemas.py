"""Server API input/output contracts.

Schemas are the public API: changing one is an API change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from common import nickname as nick
from common.types import RecordId
from node.schemas import NodeAddress
from servers.states import ServerStatus

ServerName = Annotated[str, Field(min_length=2, max_length=64)]
ServerSlug = Annotated[str, Field(min_length=2, max_length=64)]
"""Free-text server identifier; the service normalizes it (e.g. "Mi Casa" -> "mi-casa")."""
OwnerNickname = Annotated[str, Field(min_length=nick.MIN_LENGTH, max_length=nick.MAX_LENGTH)]


class ChannelBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=64)]
    kind: str = "text"
    topic: Annotated[str | None, Field(default=None, max_length=255)]
    position: int = Field(default=0, ge=0)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        """Channel names render in the UI: no blank names."""
        normalized = value.strip()
        if not normalized:
            raise ValueError("el nombre del canal no puede estar vacío")
        return normalized


class ChannelCreate(ChannelBase):
    is_default: bool = False

    @field_validator("kind", mode="after")
    @classmethod
    def validar_kind(cls, value):
        if value not in ["text", "voice"]:
            raise ValueError(f"'{value}' no es un kind válido. Use 'text' o 'voice'.")
        return value


class ChannelRead(ChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    server_id: RecordId
    is_default: bool
    live_room_id: str | None = None


class ServerBase(BaseModel):
    name: ServerName
    slug: ServerSlug
    description: Annotated[str | None, Field(default=None, max_length=1000)]


class ServerCreate(ServerBase):
    """Server creation payload; `owner_nickname` is the local in-server identity, not an account."""

    owner_nickname: OwnerNickname
    max_members: Annotated[int, Field(default=50, ge=1, le=10_000)]
    channels: Annotated[list[ChannelCreate], Field(default_factory=list)]

    @field_validator("owner_nickname")
    @classmethod
    def _valid_nickname(cls, value: str) -> str:
        return nick.validate(value)


class ServerUpdate(BaseModel):
    """Partial update to an existing server."""

    name: ServerName | None = None
    description: Annotated[str | None, Field(default=None, max_length=1000)]
    max_members: Annotated[int | None, Field(default=None, ge=1, le=10_000)]


class ServerRead(ServerBase):
    """Public server representation (no owner internals)."""

    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    status: ServerStatus
    max_members: int
    last_heartbeat_at: datetime | None
    created_at: datetime
    updated_at: datetime
    channels: list[ChannelRead] = Field(default_factory=list)

    @property
    def is_accepting_connections(self) -> bool:
        """Whether the server accepts traffic right now."""
        return self.status.accepts_traffic


class ServerAddress(BaseModel):
    """Join address for a server; servers share the node port, the slug routes."""

    model_config = ConfigDict(from_attributes=True)

    server_id: RecordId
    slug: str
    server_name: str
    is_active: bool

    node: NodeAddress

    @property
    def share_hint(self) -> str | None:
        """Shareable address, or None when the node has no resolvable IP."""
        recommended = self.node.recommended
        return f"{recommended}:{self.node.port}" if recommended else None


class ServerListResponse(BaseModel):
    """Paginated server listing."""

    items: list[ServerRead]
    total: int
    limit: int
    offset: int


class MessageCreate(BaseModel):
    """Payload for creating a text message."""

    content: Annotated[str, Field(min_length=1, max_length=2000)]

    model_config = ConfigDict(from_attributes=True)


class MessageRead(BaseModel):
    """A text message shown to the client."""

    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    author_nickname: str
    content: str
    created_at: datetime


class MessageListResponse(BaseModel):
    """Paginated message listing."""

    items: list[MessageRead]
    total: int
    limit: int
    offset: int
