from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from channels.schemas import ChannelRead
from common import nickname as nick
from common.types import RecordId
from node.schemas import NodeAddress
from servers.states import ServerStatus

ServerName = Annotated[str, Field(min_length=2, max_length=64)]
ServerSlug = Annotated[str, Field(min_length=2, max_length=64)]
OwnerNickname = Annotated[str, Field(min_length=nick.MIN_LENGTH, max_length=nick.MAX_LENGTH)]


class ServerBase(BaseModel):
    name: ServerName
    slug: ServerSlug
    description: Annotated[str | None, Field(default=None, max_length=1000)]


class ServerCreate(ServerBase):
    owner_nickname: OwnerNickname
    max_members: Annotated[int, Field(default=50, ge=1, le=10_000)]

    @field_validator("owner_nickname")
    @classmethod
    def _valid_nickname(cls, value: str) -> str:
        return nick.validate(value)


class ServerUpdate(BaseModel):
    name: ServerName | None = None
    description: Annotated[str | None, Field(default=None, max_length=1000)]
    max_members: Annotated[int | None, Field(default=None, ge=1, le=10_000)]


class ServerRead(ServerBase):
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
        return self.status.accepts_traffic


class ServerAddress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    server_id: RecordId
    slug: str
    server_name: str
    is_active: bool

    host: str | None
    port: int
    address: str | None

    node: NodeAddress

    @property
    def share_hint(self) -> str | None:
        return self.address

    @classmethod
    def from_server(cls, server: object, node: NodeAddress) -> ServerAddress:
        host = node.recommended
        port = server.bind_port  # type: ignore[attr-defined]
        return cls(
            server_id=server.id,  # type: ignore[attr-defined]
            slug=server.slug,  # type: ignore[attr-defined]
            server_name=server.name,  # type: ignore[attr-defined]
            is_active=server.status.accepts_traffic,  # type: ignore[attr-defined]
            host=host,
            port=port,
            address=f"{host}:{port}" if host else None,
            node=node,
        )


class InviteCreate(BaseModel):
    ttl_seconds: Annotated[int, Field(default=300, ge=60, le=60 * 60 * 24 * 30)]
    single_use: bool = False
    password: Annotated[str | None, Field(default=None, max_length=255)] = None


class InviteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    server_id: RecordId
    created_by: str
    created_at: datetime
    expires_at: datetime
    single_use: bool
    consumed: bool
    has_password: bool = False


class ServerStats(BaseModel):
    server_id: RecordId
    members: int
    messages: int
    attachment_bytes: int
    db_bytes: int
    total_bytes: int


class BackupRead(BaseModel):
    backup_id: str
    path: str
    size: int
    created_at: datetime


class RestoreRequest(BaseModel):
    backup_id: str | None = None
    path: str | None = None


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    server_id: RecordId
    actor_nickname: str | None
    action: str
    target_type: str | None
    target_id: str | None
    data: dict[str, object]
    created_at: datetime


class ServerListResponse(BaseModel):
    items: list[ServerRead]
    total: int
    limit: int
    offset: int
