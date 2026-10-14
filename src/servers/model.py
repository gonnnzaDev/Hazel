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

from common.types import RecordId, new_id, utcnow
from config.bdd_config.bdd_config import Base
from identity.model import Member
from servers.states import ServerStatus


def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_cls]


class ChannelKind(StrEnum):

    TEXT = "text"

    VOICE = "voice"


class Server(Base):

    __tablename__ = "servers"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    name: Mapped[str] = mapped_column(String(64), nullable=False)

    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[ServerStatus] = mapped_column(
        SAEnum(ServerStatus, name="server_status", native_enum=True, values_callable=_enum_values),
        nullable=False,
        default=ServerStatus.CREATING,
        index=True,
    )

    bind_port: Mapped[int] = mapped_column(Integer, nullable=False)

    max_members: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50)

    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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

    __tablename__ = "channels"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(64), nullable=False)

    kind: Mapped[ChannelKind] = mapped_column(
        SAEnum(ChannelKind, name="channel_kind", native_enum=True, values_callable=_enum_values),
        nullable=False,
        default=ChannelKind.TEXT,
    )

    topic: Mapped[str | None] = mapped_column(String(255), nullable=True)

    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    is_default: Mapped[bool] = mapped_column(nullable=False, default=False)

    server: Mapped[Server] = relationship(back_populates="channels")

    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_channels_server_id_name"),
        Index("ix_channels_server_id_position", "server_id", "position"),
    )


class Message(Base):

    __tablename__ = "messages"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    channel_id: Mapped[RecordId] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    author_nickname: Mapped[str] = mapped_column(String(64), nullable=False)

    content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    __table_args__ = (Index("ix_messages_channel_id_created_at", "channel_id", "created_at"),)
