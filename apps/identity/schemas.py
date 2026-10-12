"""Contratos de identidad.

Son el contrato público de la API. Un cliente mobile genera sus tipos desde acá.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from apps.common import nickname as nick
from apps.identity.roles import Role

Nickname = Annotated[str, Field(min_length=nick.MIN_LENGTH, max_length=nick.MAX_LENGTH)]
DisplayName = Annotated[str, Field(min_length=1, max_length=64)]


class JoinRequest(BaseModel):
    """Entrar a un servidor.

    Solo un nickname. Sin email, sin password, sin cuenta.
    """

    nickname: Nickname
    display_name: DisplayName | None = None
    """Nombre visible. Si no se manda, se usa el nickname con la primera letra
    mayúscula, que es lo que quiere el 90% de la gente."""

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
    """Un miembro del servidor.

    No expone nada sensible: el nickname, el nombre visible y el rol. No hay
    token ni hash en ninguna respuesta.
    """

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
        """El rol sale como texto, no como número.

        `Role` es un `IntEnum` porque en la base el orden importa (comparar roles
        es comparar enteros). Pero `"owner"` en la API es lo que un cliente
        entiende; `100` obliga a cada cliente a mantener su propia tabla de
        equivalencias. La base y la API no tienen por qué usar la misma
        representación.
        """
        return role.label


class MemberListResponse(BaseModel):
    """Listado paginado de miembros."""

    items: list[MemberRead]
    total: int
    limit: int
    offset: int


class JoinResponse(BaseModel):
    """Lo que recibís al entrar.

    El token viene **una sola vez**. Si se pierde, se entra de nuevo con el mismo
    nickname: no hay recuperación de token, porque no hay cuenta.
    """

    token: str
    """Token opaco de sesión. Scopeado a este servidor."""

    expires_at: datetime | None
    """Cuándo vence. `None` significa que no vence hasta que se revoque."""

    member: MemberRead
    server: ServerSummary


class ServerSummary(BaseModel):
    """Datos mínimos de un servidor, para acompañarlos en las respuestas."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    slug: str
    name: str


class MeResponse(BaseModel):
    """Quién sos, en el servidor de este token.

    No devuelve la lista de todos tus servidores: eso requeriría un token por
    servidor, y cada token solo conoce al suyo. Si querés ver los demás, usás el
    token de cada uno.
    """

    member: MemberRead
    server: ServerSummary


class MeUpdate(BaseModel):
    """Cambiar tu nombre visible."""

    display_name: DisplayName

    @field_validator("display_name")
    @classmethod
    def _clean(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("el nombre visible no puede estar vacío")
        return cleaned


class TokenResponse(BaseModel):
    """Un token nuevo."""

    token: str
    expires_at: datetime | None
