from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from config.conf import get_settings
from core.db.session import dispose_engine, get_engine


async def wait_for_db(timeout_seconds: float, interval: float = 1.0) -> bool:
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
            print(f"    database ready ({settings.database_url.rsplit('@', 1)[-1]})")
            return True
        except (SQLAlchemyError, OSError) as exc:
            await dispose_engine()

            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                print(
                    f"!! the database did not respond within {timeout_seconds:.0f}s "
                    f"({attempt} attempts, last error: {type(exc).__name__})",
                    file=sys.stderr,
                )
                return False

            if attempt == 1 or attempt % 5 == 0:
                print(f"    retrying... ({attempt}, {remaining:.0f}s left)")
            await asyncio.sleep(min(interval, max(remaining, 0.1)))


def main() -> int:
    parser = argparse.ArgumentParser(prog="core.wait_for_db")
    parser.add_argument("--timeout", type=float, default=60.0, help="Seconds to wait")
    parser.add_argument("--interval", type=float, default=1.0, help="Pause between attempts")
    args = parser.parse_args()

    try:
        return 0 if asyncio.run(wait_for_db(args.timeout, args.interval)) else 1
    finally:
        asyncio.run(dispose_engine())


if __name__ == "__main__":
    raise SystemExit(main())
