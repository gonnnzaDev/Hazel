from __future__ import annotations

import logging
import re
import unicodedata
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from channels import repository as channels_repository
from common.types import RecordId, new_id, utcnow
from core.api.errors import (
    ConflictError,
    InviteExpiredError,
    InviteNotFoundError,
    PermissionDeniedError,
    ServerInactiveError,
    ValidationDomainError,
)
from events.outbox import queue_event
from identity.model import Member
from servers import repository as servers_repository
from servers.model import Invite, Server
from servers.schemas import InviteCreate, ServerCreate
from servers.states import ServerStatus, can_transition

logger = logging.getLogger(__name__)

MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 64


def normalize_slug(raw: str) -> str:
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", without_accents).strip("-")


async def slug_taken(session: AsyncSession, slug: str, *, exclude: RecordId | None = None) -> bool:
    stmt = select(func.count()).select_from(Server).where(Server.slug == slug)
    if exclude is not None:
        stmt = stmt.where(Server.id != exclude)
    return (await session.execute(stmt)).scalar_one() > 0


async def create_server(session: AsyncSession, payload: ServerCreate, *, port: int) -> Server:
    slug = normalize_slug(payload.slug)
    if len(slug) < MIN_SLUG_LENGTH or len(slug) > MAX_SLUG_LENGTH:
        raise ValidationDomainError(
            "Server identifier must be between "
            f"{MIN_SLUG_LENGTH} and {MAX_SLUG_LENGTH} characters.",
            code="invalid_slug",
            extra={"slug": payload.slug},
        )

    if await slug_taken(session, slug):
        raise ConflictError(
            f"Identifier '{slug}' is already in use.",
            code="slug_taken",
            extra={"slug": slug},
        )

    server = Server(
        id=new_id(),
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
        status=ServerStatus.CREATING,
        bind_port=port,
        max_members=payload.max_members,
    )

    session.add(server)
    await session.flush()

    server.channels.append(channels_repository.default_channel())
    await session.flush()

    logger.info("server registered slug=%s port=%s", server.slug, port)
    return server


async def activate_server(session: AsyncSession, server: Server) -> Server:
    if server.status is ServerStatus.ACTIVE:
        server.last_heartbeat_at = utcnow()
        await session.flush()
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "This server was deleted and cannot be reactivated.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.ACTIVE):
        raise ConflictError(
            f"Cannot activate a server in state '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.ACTIVE.value},
        )

    server.status = ServerStatus.ACTIVE
    server.last_heartbeat_at = utcnow()
    await session.flush()

    await queue_event(
        session,
        "server.state_changed",
        server_id=server.id,
        data={"slug": server.slug, "status": server.status.value},
    )
    logger.info("server activated slug=%s", server.slug)
    return server


async def deactivate_server(session: AsyncSession, server: Server) -> Server:
    if server.status is ServerStatus.INACTIVE:
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "This server was already deleted.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.INACTIVE):
        raise ConflictError(
            f"Cannot deactivate a server in state '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.INACTIVE.value},
        )

    server.status = ServerStatus.INACTIVE
    await session.flush()

    await queue_event(
        session,
        "server.state_changed",
        server_id=server.id,
        data={"slug": server.slug, "status": server.status.value},
    )
    logger.info("server deactivated slug=%s", server.slug)
    return server


async def delete_server(session: AsyncSession, server: Server) -> None:
    if server.status.is_terminal:
        raise ConflictError(
            "This server was already deleted.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.DELETED):
        raise ConflictError(
            f"Cannot delete a server in state '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.DELETED.value},
        )

    slug = server.slug
    await session.delete(server)
    await queue_event(
        session,
        "server.state_changed",
        server_id=server.id,
        data={"slug": slug, "status": ServerStatus.DELETED.value},
    )
    logger.info("server deleted slug=%s", slug)


def ensure_active(server: Server) -> None:
    if not server.status.accepts_traffic:
        raise ServerInactiveError(
            f"Server is {server.status.value}. It accepts no connections until "
            f"its owner reactivates it.",
            extra={"server_id": str(server.id), "status": server.status.value},
        )


def ensure_member_of(member: Member, server_id: RecordId) -> None:
    if member.server_id != server_id:
        raise PermissionDeniedError(
            "You don't have access to this server.",
            code="wrong_server",
            extra={"server_id": str(server_id)},
        )


def ensure_can_invite(member: Member) -> None:
    if not member.role_enum.can_administer:
        raise PermissionDeniedError(
            "You must be an administrator to create invites.",
            code="not_admin",
        )


async def create_invite(
    session: AsyncSession, server: Server, actor: Member, payload: InviteCreate
) -> Invite:
    ensure_can_invite(actor)

    now = utcnow()
    invite = Invite(
        code=uuid4().hex[:8].upper(),
        server_id=server.id,
        created_by=actor.nickname,
        created_at=now,
        expires_at=now + timedelta(seconds=payload.ttl_seconds),
        single_use=payload.single_use,
        consumed=False,
    )
    session.add(invite)
    await session.flush()
    return invite


async def get_invite(session: AsyncSession, code: str) -> Invite:
    invite = await servers_repository.get_invite_by_code(session, code)
    if invite is None:
        raise InviteNotFoundError("Invite not found.", extra={"code": code})

    if invite.expires_at < utcnow():
        raise InviteExpiredError("Invite expired.", extra={"code": code})

    if invite.single_use and invite.consumed:
        raise ConflictError("Invite already used.", code="invite_invalid", extra={"code": code})

    if invite.single_use and not invite.consumed:
        invite.consumed = True
        await session.flush()

    return invite


async def delete_invite(session: AsyncSession, code: str) -> None:
    await servers_repository.delete_invite(session, code)
