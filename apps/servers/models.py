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

from apps.common.types import RecordId, new_id, utcnow
from apps.identity.models import Member
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
    """Un grupo de Recop.

    Un grupo vive **dentro de un nodo** y corre en **su propio proceso**, con
    **su propio puerto**. Ese puerto es lo que el dueño comparte con sus
    invitados.

    ## Por qué el grupo tiene puerto propio

    Porque corre en un proceso propio. Si dos grupos compartieran el puerto
    estarían en el mismo proceso, y un grupo que se cuelga se llevaría por
    delante a los demás. Con un proceso y un puerto por grupo, un problema afecta
    a un grupo y el dueño lo reencciende sin tocar el resto.

    El proceso del nodo tiene su propio puerto (`RECOP_PORT`), que es el del
    panel del dueño. Los puertos de los grupos se reparten desde
    `RECOP_PORT + 1` hasta `RECOP_GROUP_PORT_END`.

    ## Quién escribe acá

    Casi todo lo escribe el proceso del nodo, vía `apps.node.services`. La
    columna no se actualiza sola: el estado del grupo en la base tiene que
    coincidir con el de su proceso, y eso lo garantiza el supervisor.
    """

    __tablename__ = "servers"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    """Nombre visible del grupo. Lo elige el dueño al crearlo."""

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

    bind_port: Mapped[int] = mapped_column(Integer, nullable=False)
    """Puerto de este grupo. Lo asigna el proceso del nodo al crearlo."""

    max_members: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50)
    """Límite de miembros. Protege al dueño de un abuso de su propia máquina."""

    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    """Último latido del proceso del grupo. Distingue 'apagado' de 'caído'."""

    channels: Mapped[list[Channel]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
        order_by="Channel.position",
    )

    members: Mapped[list[Member]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
        order_by="Member.nickname",
    )

    __table_args__ = (
        CheckConstraint("bind_port BETWEEN 1 AND 65535", name="valid_port"),
        CheckConstraint("max_members > 0", name="positive_max_members"),
    )


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


class Message(Base):
    """Un mensaje de texto en un canal de un servidor."""

    __tablename__ = "messages"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    channel_id: Mapped[RecordId] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    author_nickname: Mapped[str] = mapped_column(String(64), nullable=False)
    """Apodo del miembro que envió el mensaje. Se muestra tal como fue registrado."""

    content: Mapped[str] = mapped_column(Text, nullable=False)
    """Contenido del mensaje."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    """Cuándo se envió el mensaje."""

    __table_args__ = (Index("ix_messages_channel_id_created_at", "channel_id", "created_at"),)
