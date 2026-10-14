from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "28bf06e31589"
down_revision: str | None = "2a4847c73fa2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("servers", "bind_host")
    op.drop_column("servers", "bind_port")


def downgrade() -> None:
    op.add_column("servers", sa.Column("bind_host", sa.String(length=255), nullable=True))
    op.add_column("servers", sa.Column("bind_port", sa.Integer(), nullable=True))

    op.execute("UPDATE servers SET bind_host = '0.0.0.0', bind_port = 7272")

    op.alter_column(
        "servers",
        "bind_host",
        nullable=False,
        server_default="0.0.0.0",  # noqa: S104
    )
    op.alter_column("servers", "bind_port", nullable=False)
