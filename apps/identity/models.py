"""Modelos de identidad: miembros y tokens.

Dos entidades:

- `Member`: una persona dentro de un servidor. Su identidad es su nickname, y el
  nickname solo es único **dentro de ese servidor**.
- `MemberToken`: el token de sesión de esa persona en ese servidor.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.common.types import RecordId, new_id, utcnow
from apps.identity.roles import Role
from core.db.base import Base

if TYPE_CHECKING:
    from apps.servers.models import Server


class Member(Base):
    """Una persona dentro de un servidor.

    La identidad es `(server_id, nickname)`. No hay una tabla de personas: el
    mismo nickname en dos servidores son dos filas y dos personas distintas.
    """

    __tablename__ = "members"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nickname: Mapped[str] = mapped_column(String(32), nullable=False)
    """Identidad de la persona dentro de este servidor. Canónica, en minúscula."""

    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    """Nombre visible, con la capitalización que quiera la persona.

    Es lo que ve el resto del servidor en el chat. El `nickname` es la clave, el
    `display_name` es la etiqueta.
    """

    role: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=Role.MEMBER)
    """Rol dentro del servidor. Ver `apps.identity.roles`."""

    is_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    """Si tiene una conexión abierta ahora mismo.

    Presencia real, no "última vez visto": se pone en `True` al conectarse por
    WebSocket y en `False` al desconectarse.
    """

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Cuándo se vio por última vez. Se actualiza al reconectar."""

    server: Mapped[Server] = relationship(back_populates="members")
    tokens: Mapped[list[MemberToken]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("server_id", "nickname", name="uq_members_server_id_nickname"),
        Index("ix_members_server_id_role", "server_id", "role"),
    )

    @property
    def role_enum(self) -> Role:
        """El rol como enum, no como entero.

        Los enteros van a la base porque comparar es comparar enteros; el código
        usa el enum porque `role.can_administer` se lee mejor que `role >= 50`.
        """
        return Role(self.role)


class MemberToken(Base):
    """Un token de sesión, scopeado a un miembro.

    Es un valor opaco, no un JWT. La razón es la revocación: el dueño puede
    echar a alguien, y con un token firmado eso es imposible sin mantener una
    lista de revocados, que termina siendo la lista de todos los tokens emitidos
    menos los válidos. Con el hash guardado, revocar es borrar la fila.

    Se guarda el **hash**, nunca el token. Si alguien lee la base, no puede
    iniciar sesión con los tokens de otros.
    """

    __tablename__ = "member_tokens"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    member_id: Mapped[RecordId] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    """Desnormalizado a propósito: autenticar tiene que poder filtrar por
    servidor sin un join, que es la operación más caliente de todas."""

    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    """SHA-256 en hexadecimal del token. Nunca el token en sí."""

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Vencimiento. `None` significa que no vence: el dueño lo revoca cuando quiere."""

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Cuándo se revocó. No se borra la fila: queda el rastro."""

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Última vez que se usó para autenticar una petición."""

    member: Mapped[Member] = relationship(back_populates="tokens")

    @property
    def is_usable(self) -> bool:
        """Si el token sirve para autenticar ahora."""
        if self.revoked_at is not None:
            return False
        if self.expires_at is None:
            return True
        return utcnow() < self.expires_at
