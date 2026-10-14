"""Server persistence: queries and writes without lifecycle decisions.

Lifecycle rules (transitions, deletion) live in `servers.service`, which
calls into here. Construction invariants (single default channel) are
enforced here so every writer builds valid rows.
"""

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


# ──────────────────────────────────────────────────────────────────────────────
# Normalization
# ──────────────────────────────────────────────────────────────────────────────


#: Wildcard binds: reachable on the network but not a shareable destination.
WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104


def is_wildcard_host(host: str) -> bool:
    """Whether the host is a wildcard bind rather than a concrete IP."""
    return host.strip() in WILDCARD_HOSTS


def normalize_slug(raw: str) -> str:
    """Fold a server name into a shareable identifier ("Casa de Luis" -> "casa-de-luis")."""
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", without_accents).strip("-")


async def slug_taken(session: AsyncSession, slug: str, *, exclude: RecordId | None = None) -> bool:
    """Whether another server already uses the slug."""
    stmt = select(func.count()).select_from(Server).where(Server.slug == slug)
    if exclude is not None:
        stmt = stmt.where(Server.id != exclude)
    return (await session.execute(stmt)).scalar_one() > 0


# ──────────────────────────────────────────────────────────────────────────────
# Reads
# ──────────────────────────────────────────────────────────────────────────────


async def get_server(session: AsyncSession, server_id: RecordId) -> Server:
    """Load a server with its channels; raises `NotFoundError` if missing."""
    stmt = select(Server).options(selectinload(Server.channels)).where(Server.id == server_id)
    server = (await session.execute(stmt)).scalar_one_or_none()

    if server is None:
        raise NotFoundError(
            "El servidor no existe.",
            code="server_not_found",
            extra={"server_id": str(server_id)},
        )
    return server


async def list_servers(
    session: AsyncSession, *, limit: int, offset: int
) -> tuple[list[Server], int]:
    """Paginated listing, newest first (UUIDv7 ids already order by creation time)."""
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
    """Find a server by its shared slug."""
    stmt = select(Server).options(selectinload(Server.channels)).where(Server.slug == slug)
    server = (await session.execute(stmt)).scalar_one_or_none()

    if server is None:
        raise NotFoundError(
            f"No hay ningún servidor con el identificador '{slug}'.",
            code="server_not_found_by_slug",
            extra={"slug": slug},
        )
    return server


# ──────────────────────────────────────────────────────────────────────────────
# Construction helpers and plain writes
# ──────────────────────────────────────────────────────────────────────────────


def build_channels(payload_channels: list[ChannelCreate]) -> list[Channel]:
    """Build initial channel rows from the creation payload."""
    channels: list[Channel] = []
    for raw in payload_channels:
        try:
            kind = ChannelKind(raw.kind)
        except ValueError:
            raise ValidationDomainError(
                f"'{raw.kind}' no es un tipo de canal válido.",
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
    """Ensure exactly one default channel."""
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
            "Un servidor no puede tener más de un canal por defecto.",
            code="multiple_default_channels",
        )
    if not defaults:
        # First by position becomes the entry channel.
        server.channels[0].is_default = True


async def update_server(session: AsyncSession, server: Server, payload: ServerUpdate) -> Server:
    """Apply partial config changes."""
    changes = payload.model_dump(exclude_unset=True)

    for field, value in changes.items():
        setattr(server, field, value)

    await session.flush()
    return server


async def heartbeat(session: AsyncSession, server: Server, *, at: datetime | None = None) -> Server:
    """Record liveness; distinguishes intentional stop from crash."""
    server.last_heartbeat_at = at or utcnow()
    await session.flush()
    return server


async def mark_all_inactive(session: AsyncSession) -> int:
    """Mark CREATING/ACTIVE servers INACTIVE at node startup (covers crashes/kills)."""
    result = await session.execute(
        update(Server)
        .where(Server.status.in_([ServerStatus.CREATING, ServerStatus.ACTIVE]))
        .values(status=ServerStatus.INACTIVE, updated_at=utcnow())
        .returning(Server.id)
    )
    count = len(result.all())
    if count:
        logger.info(
            "%d servidor(es) quedaron inactivos tras el arranque del nodo. "
            "Ninguno escucha hasta que su dueño los vuelva a activar.",
            count,
        )
    return count


async def create_message(
    session: AsyncSession, channel_id: RecordId, author_nickname: str, content: str
) -> Message:
    """Record a text message; no permission check (enforced by the client)."""
    message = Message(
        id=new_id(),
        channel_id=channel_id,
        author_nickname=author_nickname,
        content=content,
    )
    session.add(message)
    await session.flush()
    logger.info("mensaje registrado canal=%s nick=%s", channel_id, author_nickname)
    return message


async def list_messages(
    session: AsyncSession, channel_id: RecordId, limit: int = 50, offset: int = 0
) -> tuple[list[Message], int]:
    """Channel history, newest first."""
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
