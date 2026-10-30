from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7f1a9c3e5d2"
down_revision: str | None = "ee7b2c93f841"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("server_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("single_use", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("consumed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["server_id"],
            ["servers.id"],
            name=op.f("fk_invites_server_id_servers"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invites")),
        sa.UniqueConstraint("code", name=op.f("uq_invites_code")),
    )
    op.create_index("ix_invites_server_id", "invites", ["server_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_invites_server_id", table_name="invites")
    op.drop_table("invites")
