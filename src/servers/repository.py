from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from common.types import RecordId, utcnow
from core.api.errors import NotFoundError
from servers.model import Server
from servers.schemas import ServerUpdate
from servers.states import ServerStatus

logger = logging.getLogger(__name__)


WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104


def is_wildcard_host(host: str) -> bool:
    return host.strip() in WILDCARD_HOSTS


def normalize_slug(raw: str) -> str:
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", without_accents).strip("-")


async def slug_taken(session: AsyncSession, slug: str, *, exclude: RecordId | None = None) -> bool:
    stmt = select(func.count()).select_from(Server).where(Server.slug == slug)
    if exclude is not None:
        stmt = stmt.where(Server.id != exclude)
    return (await session.execute(stmt)).scalar_one() > 0


async def get_server(session: AsyncSession, server_id: RecordId) -> Server:
    stmt = select(Server).options(selectinload(Server.channels)).where(Server.id == server_id)
    server = (await session.execute(stmt)).scalar_one_or_none()

    if server is None:
        raise NotFoundError(
            "The server does not exist.",
            code="server_not_found",
            extra={"server_id": str(server_id)},
        )
    return server


async def list_servers(
    session: AsyncSession, *, limit: int, offset: int
) -> tuple[list[Server], int]:
    total = (await session.execute(select(func.count()).select_from(Server))).scalar_one()

    stmt = (
        select(Server)
        .options(selectinload(Server.channels))
        .order_by(Server.id.desc())
        .limit(limit)
        .offset(offset)
    )
    servers = (await session.execute(stmt)).scalars().all()
    return list(servers), int(total)


async def resolve_by_slug(session: AsyncSession, slug: str) -> Server:
    stmt = select(Server).options(selectinload(Server.channels)).where(Server.slug == slug)
    server = (await session.execute(stmt)).scalar_one_or_none()

    if server is None:
        raise NotFoundError(
            f"No server found with identifier '{slug}'.",
            code="server_not_found_by_slug",
            extra={"slug": slug},
        )
    return server


async def update_server(session: AsyncSession, server: Server, payload: ServerUpdate) -> Server:
    changes = payload.model_dump(exclude_unset=True)

    for field, value in changes.items():
        setattr(server, field, value)

    await session.flush()
    return server


async def heartbeat(session: AsyncSession, server: Server, *, at: datetime | None = None) -> Server:
    server.last_heartbeat_at = at or utcnow()
    await session.flush()
    return server


async def mark_all_inactive(session: AsyncSession) -> int:
    result = await session.execute(
        update(Server)
        .where(Server.status.in_([ServerStatus.CREATING, ServerStatus.ACTIVE]))
        .values(status=ServerStatus.INACTIVE, updated_at=utcnow())
        .returning(Server.id)
    )
    count = len(result.all())
    if count:
        logger.info(
            "%d server(s) went inactive after node startup. "
            "None listens until its owner reactivates it.",
            count,
        )
    return count
