"""Modelos del servidor y sus canales.

Dos entidades:

- `Server`: un servidor hosteado por su dueño en su propia máquina.
- `Channel`: una sala de chat dentro de un servidor.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.common.types import RecordId, new_id
from apps.servers.states import ServerStatus
from core.db.base import Base


def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    """Devuelve los *valores* de un StrEnum para usarlos en el tipo de PostgreSQL.

    Sin esto, SQLAlchemy persiste los NOMBRES de los miembros (`ACTIVE`) en vez
    de los valores (`active`). Los valores son los que ve la API y los que
    escriben las migraciones a mano, así que son los que van a la base.
    """
    return [member.value for member in enum_cls]


class ChannelKind(StrEnum):
    """Tipo de sala de chat."""

    TEXT = "text"
    """Sala de conversación normal."""

    VOICE = "voice"
    """Canal de voz. El modelo de audio todavía no está definido."""


class Server(Base):
    """Un servidor de Recop.

    Un servidor vive **dentro de un nodo**. El nodo es el proceso que corre en la
    máquina del dueño, y es el nodo el que escucha en un puerto. Por eso esta
    tabla no tiene `bind_port`: el puerto es del nodo, no del servidor. Varios
    servidores comparten el mismo puerto y se distinguen por su `slug`.

    Esto es lo que permite que un cliente se conecte a una sola dirección y vea
    todos sus servidores, y lo que hace que empaquetar Recop para mobile sea
    viable en vez de un proceso por grupo de chat.

    Nota sobre el dueño: la persona que levanta el nodo es el dueño, y su
    identidad local es un nickname. Todavía no hay una columna `owner_nickname`
    porque la identidad llega en la app de `identity`.
    """

    __tablename__ = "servers"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    """Nombre visible del servidor. Lo elige el dueño al crearlo."""

    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    """Identificador legible para compartir. Ej: `casa-de-luis`."""

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[ServerStatus] = mapped_column(
        SAEnum(ServerStatus, name="server_status", native_enum=True, values_callable=_enum_values),
        nullable=False,
        default=ServerStatus.CREATING,
        index=True,
    )
    """Estado del ciclo de vida. Ver `apps/servers/states.py`."""

    max_members: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50)
    """Límite de miembros. Protege al dueño de un abuso de su propia máquina."""

    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    """Último latido del proceso. Permite distinguir 'apagado' de 'caído'."""

    channels: Mapped[list[Channel]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
        order_by="Channel.position",
    )

    __table_args__ = (CheckConstraint("max_members > 0", name="positive_max_members"),)


class Channel(Base):
    """Una sala de chat dentro de un servidor."""

    __tablename__ = "channels"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    """Nombre del canal. Ej: `general`, `game-over`."""

    kind: Mapped[ChannelKind] = mapped_column(
        SAEnum(ChannelKind, name="channel_kind", native_enum=True, values_callable=_enum_values),
        nullable=False,
        default=ChannelKind.TEXT,
    )

    topic: Mapped[str | None] = mapped_column(String(255), nullable=True)

    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    """Orden de presentación en la sidebar del cliente."""

    is_default: Mapped[bool] = mapped_column(nullable=False, default=False)
    """Canal al que se entra automáticamente. Hay exactamente uno por servidor."""

    server: Mapped[Server] = relationship(back_populates="channels")

    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_channels_server_id_name"),
        Index("ix_channels_server_id_position", "server_id", "position"),
    )
