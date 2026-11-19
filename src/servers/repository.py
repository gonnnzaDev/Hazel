from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from channels.model import Channel
from common.types import RecordId, new_id, utcnow
from core.api.errors import NotFoundError
from identity.model import Member
from messages.model import Attachment, Message
from servers.model import AuditEvent, Invite, Server
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


async def get_invite_by_code(session: AsyncSession, code: str) -> Invite | None:
    stmt = select(Invite).where(Invite.code == code)
    return (await session.execute(stmt)).scalar_one_or_none()


async def delete_invite(session: AsyncSession, code: str) -> None:
    invite = await get_invite_by_code(session, code)

    if invite is None:
        raise NotFoundError(
            "Invite not found.",
            code="invite_not_found",
            extra={"code": code},
        )

    await session.delete(invite)


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


async def create_audit_event(
    session: AsyncSession,
    *,
    server_id: RecordId,
    actor_nickname: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    data: dict[str, object] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        id=new_id(),
        server_id=server_id,
        actor_nickname=actor_nickname,
        action=action,
        target_type=target_type,
        target_id=target_id,
        data=data or {},
    )
    session.add(event)
    await session.flush()
    return event


async def list_audit_events(
    session: AsyncSession, server_id: RecordId, *, limit: int, offset: int
) -> tuple[list[AuditEvent], int]:
    total = (
        await session.execute(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.server_id == server_id)
        )
    ).scalar_one()
    rows = (
        (
            await session.execute(
                select(AuditEvent)
                .where(AuditEvent.server_id == server_id)
                .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return list(rows), int(total)


async def server_stats(session: AsyncSession, server_id: RecordId) -> tuple[int, int, int, int]:
    members = (
        await session.execute(
            select(func.count()).select_from(Member).where(Member.server_id == server_id)
        )
    ).scalar_one()
    msg_stmt = (
        select(func.count())
        .select_from(Message)
        .join(Channel, Channel.id == Message.channel_id)
        .where(Channel.server_id == server_id)
    )
    messages = (await session.execute(msg_stmt)).scalar_one()
    att_stmt = (
        select(func.coalesce(func.sum(Attachment.size), 0))
        .select_from(Attachment)
        .join(Message, Message.id == Attachment.message_id)
        .join(Channel, Channel.id == Message.channel_id)
        .where(Channel.server_id == server_id)
    )
    attachment_bytes = (await session.execute(att_stmt)).scalar_one()
    db_size = 0
    try:
        db_size = (
            await session.execute(select(func.pg_database_size(func.current_database())))
        ).scalar_one()
    except Exception:
        db_size = 0
    return int(members), int(messages), int(attachment_bytes or 0), int(db_size or 0)


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
