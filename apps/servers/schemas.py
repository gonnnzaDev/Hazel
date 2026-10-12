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
from apps.servers.states import ServerStatus

ServerName = Annotated[str, Field(min_length=2, max_length=64)]
ServerSlug = Annotated[str, Field(min_length=2, max_length=64)]
"""Identificador del servidor, en texto libre.

El schema NO exige que venga normalizado: acepta `"Mi Casa"` y el service lo
convierte en `mi-casa`. Obligar al cliente a mandar el slug ya normalizado
duplica una regla de negocio en el frontend y hace la API más estricta sin
ganancia. La validación real se hace sobre el valor normalizado, en el service.
"""
BindPort = Annotated[int, Field(ge=1, le=65535)]
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


class ChannelRead(ChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    server_id: RecordId
    is_default: bool


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
    bind_host: Annotated[str, Field(default="0.0.0.0", max_length=255)]  # noqa: S104 — por defecto el nodo es alcanzable por la red
    bind_port: BindPort
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
    bind_port: BindPort | None = None


class ServerRead(ServerBase):
    """Representación pública de un servidor.

    No expone `owner_nickname`: es información interna del dueño.
    """

    model_config = ConfigDict(from_attributes=True)

    id: RecordId
    status: ServerStatus
    bind_host: str
    bind_port: int
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
    """La dirección que el dueño comparte con sus invitados.

    Es lo único que necesita un amigo para conectarse.
    """

    model_config = ConfigDict(from_attributes=True)

    server_id: RecordId
    slug: str
    host: str
    port: int
    is_reachable: bool
    host_is_wildcard: bool = False
    """Si `host` es una dirección comodín (`0.0.0.0`).

    Cuando es así, `host:port` **no sirve para conectarse**: `0.0.0.0` es donde
    escucha el proceso, no una dirección a la que se pueda llegar. El dueño
    tiene que reemplazar `0.0.0.0` por la IP de su máquina en la red local
    (ej. `192.168.1.50`) antes de compartir la dirección.

    Lo exponemos en vez de adivinar la IP por nuestra cuenta: un nodo puede
    tener VPN, docker o varias placas de red, y adivinar mal es peor que
    decirlo.
    """

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"


class ServerListResponse(BaseModel):
    """Listado paginado de servidores."""

    items: list[ServerRead]
    total: int
    limit: int
    offset: int
