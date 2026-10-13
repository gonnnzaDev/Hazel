"""Contratos de entrada y salida del servidor.

Son el contrato público de la API. Un cliente mobile genera sus tipos desde acá,
así que cambiar un schema es un cambio de API y tiene que ser deliberado.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from apps.common import nickname as nick
from apps.common.types import RecordId
from apps.node.schemas import NodeAddress
from apps.servers.states import ServerStatus

ServerName = Annotated[str, Field(min_length=2, max_length=64)]
ServerSlug = Annotated[str, Field(min_length=2, max_length=64)]
"""Identificador del servidor, en texto libre.

El schema NO exige que venga normalizado: acepta `"Mi Casa"` y el service lo
convierte en `mi-casa`. Obligar al cliente a mandar el slug ya normalizado
duplica una regla de negocio en el frontend y hace la API más estricta sin
ganancia. La validación real se hace sobre el valor normalizado, en el service.
"""
OwnerNickname = Annotated[str, Field(min_length=nick.MIN_LENGTH, max_length=nick.MAX_LENGTH)]


class ChannelBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=64)]
    kind: str = "text"
    topic: Annotated[str | None, Field(default=None, max_length=255)]
    position: int = Field(default=0, ge=0)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        """El nombre del canal se muestra en la UI: no admitimos espacios sueltos."""
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
    """Payload para crear un servidor.

    `owner_nickname` es el nickname local de quien está levantando el servidor en
    su máquina. No es una cuenta: es la identidad **dentro** de este servidor.
    """

    owner_nickname: OwnerNickname
    max_members: Annotated[int, Field(default=50, ge=1, le=10_000)]
    channels: Annotated[list[ChannelCreate], Field(default_factory=list)]

    @field_validator("owner_nickname")
    @classmethod
    def _valid_nickname(cls, value: str) -> str:
        return nick.validate(value)


class ServerUpdate(BaseModel):
    """Cambios parciales sobre un servidor existente."""

    name: ServerName | None = None
    description: Annotated[str | None, Field(default=None, max_length=1000)]
    max_members: Annotated[int | None, Field(default=None, ge=1, le=10_000)]


class ServerRead(ServerBase):
    """Representación pública de un servidor.

    No expone `owner_nickname`: es información interna del dueño.
    """

    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    status: ServerStatus
    bind_port: int
    """Puerto del proceso del grupo. Es el que el dueño comparte."""

    max_members: int
    last_heartbeat_at: datetime | None
    created_at: datetime
    updated_at: datetime
    channels: list[ChannelRead] = Field(default_factory=list)

    @property
    def is_accepting_connections(self) -> bool:
        """Si el servidor acepta tráfico ahora mismo."""
        return self.status.accepts_traffic


class ServerAddress(BaseModel):
    """La dirección por la que se entra a un servidor concreto.

    Todos los servidores de un nodo comparten el puerto del nodo. Lo que cambia
    es a cuál se llega, y eso lo decide el `slug`.
    """

    model_config = ConfigDict(from_attributes=True)

    server_id: RecordId
    slug: str
    server_name: str
    is_active: bool
    """Si el servidor acepta tráfico ahora mismo."""

    node: NodeAddress
    """Dirección del nodo: puerto, interfaces candidatas y cuál se recomienda."""

    @property
    def share_hint(self) -> str | None:
        """La dirección para compartir, si se puede determinar.

        Es None si el nodo está en una máquina donde no se pudo resolver ninguna
        IP (por ejemplo, un contenedor sin red o una máquina sin interfaces).
        """
        recommended = self.node.recommended
        return f"{recommended}:{self.node.port}" if recommended else None


class ServerListResponse(BaseModel):
    """Listado paginado de servidores."""

    items: list[ServerRead]
    total: int
    limit: int
    offset: int


class MessageCreate(BaseModel):
    """Payload para crear un mensaje de texto."""

    content: Annotated[str, Field(min_length=1, max_length=2000)]

    model_config = ConfigDict(from_attributes=True)


class MessageRead(BaseModel):
    """Un mensaje de texto mostrado al cliente."""

    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    author_nickname: str
    content: str
    created_at: datetime


class MessageListResponse(BaseModel):
    """Listado paginado de mensajes."""

    items: list[MessageRead]
    total: int
    limit: int
    offset: int
