from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from common.types import new_id, utcnow
from core.api.errors import ConflictError, ServerInactiveError, ValidationDomainError
from servers.model import Server
from servers.repository import (
    build_channels,
    ensure_default_channel,
    normalize_slug,
    slug_taken,
)
from servers.schemas import ServerCreate
from servers.states import ServerStatus, can_transition

logger = logging.getLogger(__name__)

MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 64


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
        channels=build_channels(payload.channels),
    )

    ensure_default_channel(server)
    session.add(server)
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
    logger.info("server deleted slug=%s", slug)


def ensure_active(server: Server) -> None:
    if not server.status.accepts_traffic:
        raise ServerInactiveError(
            f"Server is {server.status.value}. It accepts no connections until "
            f"its owner reactivates it.",
            extra={"server_id": str(server.id), "status": server.status.value},
        )
