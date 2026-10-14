from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from common.types import RecordId, new_id, utcnow
from core.api.errors import NotFoundError, ValidationDomainError
from servers.model import Channel, ChannelKind, Message, Server
from servers.schemas import ChannelCreate, ServerUpdate
from servers.states import ServerStatus

logger = logging.getLogger(__name__)

DEFAULT_CHANNEL_NAME = "general"


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


def build_channels(payload_channels: list[ChannelCreate]) -> list[Channel]:
    channels: list[Channel] = []
    for raw in payload_channels:
        try:
            kind = ChannelKind(raw.kind)
        except ValueError:
            raise ValidationDomainError(
                f"'{raw.kind}' is not a valid channel kind.",
                code="invalid_channel_kind",
                extra={"allowed": [k.value for k in ChannelKind]},
            ) from None
        channels.append(
            Channel(
                id=new_id(),
                name=raw.name.strip(),
                kind=kind,
                topic=raw.topic,
                position=raw.position,
                is_default=raw.is_default,
            )
        )
    return channels


def ensure_default_channel(server: Server) -> None:
    if not server.channels:
        server.channels.append(
            Channel(
                id=new_id(),
                name=DEFAULT_CHANNEL_NAME,
                kind=ChannelKind.TEXT,
                is_default=True,
            )
        )
        return

    defaults = [c for c in server.channels if c.is_default]
    if len(defaults) > 1:
        raise ValidationDomainError(
            "A server cannot have more than one default channel.",
            code="multiple_default_channels",
        )
    if not defaults:
        server.channels[0].is_default = True


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


async def create_message(
    session: AsyncSession, channel_id: RecordId, author_nickname: str, content: str
) -> Message:
    message = Message(
        id=new_id(),
        channel_id=channel_id,
        author_nickname=author_nickname,
        content=content,
    )
    session.add(message)
    await session.flush()
    logger.info("message recorded channel=%s nick=%s", channel_id, author_nickname)
    return message


async def list_messages(
    session: AsyncSession, channel_id: RecordId, limit: int = 50, offset: int = 0
) -> tuple[list[Message], int]:
    total = (
        await session.execute(
            select(func.count()).select_from(Message).where(Message.channel_id == channel_id)
        )
    ).scalar_one()
    stmt = (
        select(Message)
        .where(Message.channel_id == channel_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    messages = (await session.execute(stmt)).scalars().all()
    return list(messages), int(total)
