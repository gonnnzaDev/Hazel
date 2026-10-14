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

from common.types import RecordId, new_id, utcnow
from config.bdd_config.bdd_config import Base
from identity.roles import Role

if TYPE_CHECKING:
    from servers.model import Server


class Member(Base):

    __tablename__ = "members"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nickname: Mapped[str] = mapped_column(String(32), nullable=False)

    display_name: Mapped[str] = mapped_column(String(64), nullable=False)

    role: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=Role.MEMBER)

    is_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
        return Role(self.role)


class MemberToken(Base):

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

    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    member: Mapped[Member] = relationship(back_populates="tokens")

    @property
    def is_usable(self) -> bool:
        if self.revoked_at is not None:
            return False
        if self.expires_at is None:
            return True
        return utcnow() < self.expires_at
