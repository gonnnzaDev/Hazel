"""Wait for PostgreSQL before migrations/startup.

In Docker both containers start together and PG needs seconds; else the entrypoint crash-loops.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from core.config import get_settings
from core.db.session import dispose_engine, get_engine


async def wait_for_db(timeout_seconds: float, interval: float = 1.0) -> bool:
    """Poll until SELECT 1 succeeds or timeout."""
    settings = get_settings()
    engine = get_engine()
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    attempt = 0

    while True:
        attempt += 1
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            await dispose_engine()
            print(f"    base de datos lista ({settings.database_url.rsplit('@', 1)[-1]})")
            return True
        # asyncpg leaks raw OSError outside SQLAlchemy; both must be caught.
        except (SQLAlchemyError, OSError) as exc:
            # Drop failed pool connections; else retries reuse a dead socket.
            await dispose_engine()

            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                print(
                    f"!! la base de datos no respondió en {timeout_seconds:.0f}s "
                    f"({attempt} intentos, último error: {type(exc).__name__})",
                    file=sys.stderr,
                )
                return False

            if attempt == 1 or attempt % 5 == 0:
                print(f"    reintentando... ({attempt}, quedan {remaining:.0f}s)")
            await asyncio.sleep(min(interval, max(remaining, 0.1)))


def main() -> int:
    parser = argparse.ArgumentParser(prog="core.wait_for_db")
    parser.add_argument("--timeout", type=float, default=60.0, help="Segundos a esperar")
    parser.add_argument("--interval", type=float, default=1.0, help="Pausa entre intentos")
    args = parser.parse_args()

    try:
        return 0 if asyncio.run(wait_for_db(args.timeout, args.interval)) else 1
    finally:
        asyncio.run(dispose_engine())


if __name__ == "__main__":
    raise SystemExit(main())
