from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from common.types import RecordId, new_id, utcnow
from config.bdd_config.bdd_config import Base


class Message(Base):

    __tablename__ = "messages"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    channel_id: Mapped[RecordId] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True
    )

    author_nickname: Mapped[str] = mapped_column(String(64), nullable=False)

    content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    __table_args__ = (Index("ix_messages_channel_id_created_at", "channel_id", "created_at"),)
