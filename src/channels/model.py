from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum
from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from common.types import RecordId, new_id
from config.bdd_config.bdd_config import Base

if TYPE_CHECKING:
    from servers.model import Server


class ChannelKind(StrEnum):
    TEXT = "text"

    VOICE = "voice"


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(64), nullable=False)

    kind: Mapped[ChannelKind] = mapped_column(
        SAEnum(ChannelKind, name="channel_kind", native_enum=True),
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
