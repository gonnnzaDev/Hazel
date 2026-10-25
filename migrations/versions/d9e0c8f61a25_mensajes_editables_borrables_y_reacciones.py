from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d9e0c8f61a25"
down_revision: str | None = "b3d1a7c92f40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("author_member_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_messages_author_member_id_members"),
        "messages",
        "members",
        ["author_member_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("messages", sa.Column("reply_to", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_messages_reply_to_messages"),
        "messages",
        "messages",
        ["reply_to"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "messages",
        sa.Column(
            "attachments",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_index(
        "ix_messages_author_member_id_created_at",
        "messages",
        ["author_member_id", "created_at"],
    )
    op.create_table(
        "reactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("emoji", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            name=op.f("fk_reactions_message_id_messages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["members.id"],
            name=op.f("fk_reactions_member_id_members"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reactions")),
        sa.UniqueConstraint(
            "message_id", "member_id", "emoji", name="uq_reactions_message_member_emoji"
        ),
    )
    op.create_index(op.f("ix_reactions_message_id"), "reactions", ["message_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_reactions_message_id"), table_name="reactions")
    op.drop_table("reactions")
    op.drop_index("ix_messages_author_member_id_created_at", table_name="messages")
    op.drop_column("messages", "attachments")
    op.drop_column("messages", "deleted_at")
    op.drop_column("messages", "edited_at")
    op.drop_constraint(op.f("fk_messages_reply_to_messages"), "messages", type_="foreignkey")
    op.drop_column("messages", "reply_to")
    op.drop_constraint(op.f("fk_messages_author_member_id_members"), "messages", type_="foreignkey")
    op.drop_column("messages", "author_member_id")
