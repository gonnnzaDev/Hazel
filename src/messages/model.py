from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from common.types import RecordId, new_id
from config.bdd_config.bdd_config import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    channel_id: Mapped[RecordId] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True
    )

    author_nickname: Mapped[str] = mapped_column(String(64), nullable=False)

    author_member_id: Mapped[RecordId | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True
    )

    content: Mapped[str] = mapped_column(Text, nullable=False)

    reply_to: Mapped[RecordId | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )

    attachments: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_messages_channel_id_created_at", "channel_id", "created_at"),
        Index("ix_messages_author_member_id_created_at", "author_member_id", "created_at"),
    )


class Reaction(Base):
    __tablename__ = "reactions"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    message_id: Mapped[RecordId] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )

    member_id: Mapped[RecordId] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )

    emoji: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "message_id", "member_id", "emoji", name="uq_reactions_message_member_emoji"
        ),
    )
