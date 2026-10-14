from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from common.types import RecordId, new_id
from config.bdd_config.bdd_config import Base
from identity.model import Member
from servers.states import ServerStatus

if TYPE_CHECKING:
    from channels.model import Channel


def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_cls]


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
