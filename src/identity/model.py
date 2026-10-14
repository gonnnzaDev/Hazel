"""Identity models: per-server members and session tokens."""

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
from core.db.base import Base
from identity.roles import Role

if TYPE_CHECKING:
    from servers.model import Server


class Member(Base):
    """A person within a server; identity is (server_id, nickname)."""

    __tablename__ = "members"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nickname: Mapped[str] = mapped_column(String(32), nullable=False)
    """Canonical lowercase identity within this server."""

    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    """User-chosen visible name; nickname is the key."""

    role: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=Role.MEMBER)
    """Server role; see identity.roles."""

    is_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    """True while a WebSocket connection is open."""

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Last reconnect time."""

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
        """Role as enum instead of stored int."""
        return Role(self.role)


class MemberToken(Base):
    """Opaque session token (not JWT) for cheap revocation. Only the hash is stored."""

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
    """Denormalized to authenticate without a join."""

    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    """Hex SHA-256 of token; never the raw token."""

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Expiry; None means non-expiring until revoked."""

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Revocation time; row kept for audit."""

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """Last authentication use."""

    member: Mapped[Member] = relationship(back_populates="tokens")

    @property
    def is_usable(self) -> bool:
        """Whether the token authenticates now."""
        if self.revoked_at is not None:
            return False
        if self.expires_at is None:
            return True
        return utcnow() < self.expires_at
