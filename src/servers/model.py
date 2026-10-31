from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from common.types import RecordId, new_id
from config.bdd_config.bdd_config import Base
from identity.model import Member
from servers.states import ServerStatus

if TYPE_CHECKING:
    from channels.model import Channel


def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_cls]


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)

    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.now
    )

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    single_use: Mapped[bool] = mapped_column(nullable=False, default=False)

    consumed: Mapped[bool] = mapped_column(nullable=False, default=False)

    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    actor_nickname: Mapped[str | None] = mapped_column(String(64), nullable=True)

    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)

    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)

    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    data: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.now
    )


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

    invites: Mapped[list[Invite]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("bind_port BETWEEN 1 AND 65535", name="valid_port"),
        CheckConstraint("max_members > 0", name="positive_max_members"),
    )


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_by: Mapped[str] = mapped_column(String(32), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    single_use: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    consumed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    server: Mapped[Server] = relationship(back_populates="invites")
