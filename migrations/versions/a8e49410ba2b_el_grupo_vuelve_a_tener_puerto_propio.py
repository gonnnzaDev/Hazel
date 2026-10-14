from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8e49410ba2b"
down_revision: str | None = "41cdd7db0313"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FIRST_GROUP_PORT = 7273


def upgrade() -> None:
    op.add_column("servers", sa.Column("bind_port", sa.Integer(), nullable=True))

    op.get_bind().execute(
        sa.text(
            """
            UPDATE servers AS s
            SET bind_port = :first + r.n - 1
            FROM (
                SELECT id, row_number() OVER (ORDER BY id) AS n
                FROM servers
                WHERE bind_port IS NULL
            ) AS r
            WHERE s.id = r.id
            """
        ),
        {"first": FIRST_GROUP_PORT},
    )

    op.alter_column("servers", "bind_port", nullable=False)

    op.execute(
        "ALTER TABLE servers ADD CONSTRAINT ck_servers_valid_port "
        "CHECK (bind_port BETWEEN 1 AND 65535)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE servers DROP CONSTRAINT IF EXISTS ck_servers_valid_port")
    op.drop_column("servers", "bind_port")
