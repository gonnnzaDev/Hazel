"""Server lifecycle business logic (no FastAPI; raises domain errors).

Deactivating preserves all data; deleting is the only destructive op.
Persistence lives in `servers.repository`.
"""

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
    """Register a new group; the caller assigns the port. Starts CREATING until live."""
    slug = normalize_slug(payload.slug)
    if len(slug) < MIN_SLUG_LENGTH or len(slug) > MAX_SLUG_LENGTH:
        raise ValidationDomainError(
            "El identificador del servidor debe tener entre "
            f"{MIN_SLUG_LENGTH} y {MAX_SLUG_LENGTH} caracteres.",
            code="invalid_slug",
            extra={"slug": payload.slug},
        )

    if await slug_taken(session, slug):
        raise ConflictError(
            f"El identificador '{slug}' ya está en uso.",
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

    logger.info("servidor registrado slug=%s puerto=%s", server.slug, port)
    return server


async def activate_server(session: AsyncSession, server: Server) -> Server:
    """Activate the server; already-active is a no-op, not an error."""
    if server.status is ServerStatus.ACTIVE:
        server.last_heartbeat_at = utcnow()
        await session.flush()
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "Este servidor fue eliminado y no se puede volver a activar.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.ACTIVE):
        raise ConflictError(
            f"No se puede activar un servidor en estado '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.ACTIVE.value},
        )

    server.status = ServerStatus.ACTIVE
    server.last_heartbeat_at = utcnow()
    await session.flush()

    logger.info("servidor activado slug=%s", server.slug)
    return server


async def deactivate_server(session: AsyncSession, server: Server) -> Server:
    """Deactivate and close the port; preserves all data for reactivation."""
    if server.status is ServerStatus.INACTIVE:
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "Este servidor ya fue eliminado.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.INACTIVE):
        raise ConflictError(
            f"No se puede desactivar un servidor en estado '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.INACTIVE.value},
        )

    server.status = ServerStatus.INACTIVE
    await session.flush()

    logger.info("servidor desactivado slug=%s", server.slug)
    return server


async def delete_server(session: AsyncSession, server: Server) -> None:
    """Permanently delete the server (the only destructive op); channels cascade."""
    if server.status.is_terminal:
        raise ConflictError(
            "Este servidor ya fue eliminado.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.DELETED):
        raise ConflictError(
            f"No se puede eliminar un servidor en estado '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.DELETED.value},
        )

    slug = server.slug
    await session.delete(server)
    logger.info("servidor eliminado slug=%s", slug)


def ensure_active(server: Server) -> None:
    """Raise a clear error unless the server accepts traffic."""
    if not server.status.accepts_traffic:
        raise ServerInactiveError(
            f"El servidor está {server.status.value}. No acepta conexiones hasta "
            f"que su dueño lo vuelva a activar.",
            extra={"server_id": str(server.id), "status": server.status.value},
        )
