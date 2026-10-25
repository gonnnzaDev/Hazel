from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3d1a7c92f40"
down_revision: str | None = "a8e49410ba2b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    duplicate_servers = conn.execute(
        sa.text(
            "SELECT count(*) FROM ("
            "  SELECT server_id FROM channels WHERE is_default"
            "  GROUP BY server_id HAVING count(*) > 1"
            ") d"
        )
    ).scalar_one()
    if duplicate_servers:
        raise RuntimeError(
            f"{duplicate_servers} server(s) hold more than one default channel. "
            "Fix the data by hand before this migration can run."
        )

    op.create_index(
        "uq_channels_server_default",
        "channels",
        ["server_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index("uq_channels_server_default", table_name="channels")
