from __future__ import annotations

from typing import Any

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from common.types import RecordId, new_id
from config.bdd_config.bdd_config import Base


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[RecordId] = mapped_column(primary_key=True, default=new_id)

    event_type: Mapped[str] = mapped_column(String(64), nullable=False)

    server_id: Mapped[RecordId] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )

    channel_id: Mapped[RecordId | None] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), nullable=True
    )

    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (Index("ix_outbox_events_server_id_id", "server_id", "id"),)
