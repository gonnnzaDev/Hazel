"""Node services: groups and their processes.

Invariant: DB state must match process state; DB is written only after the process is up.
"""

from __future__ import annotations

import logging
from typing import Any

from apps.common.types import RecordId, utcnow
from apps.identity.roles import Role
from apps.servers import services as servers_services
from apps.servers.models import Server
from apps.servers.schemas import ServerCreate
from apps.servers.services import get_server, list_servers, normalize_slug, slug_taken
from apps.servers.states import ServerStatus
from core.api.errors import ConflictError, PermissionDeniedError, ValidationDomainError
from core.config import get_settings
from core.network import local_addresses
from core.ports import next_available_port

logger = logging.getLogger(__name__)

#: Seconds to wait for a group process to become ready.
GROUP_READY_TIMEOUT_SECONDS = 20.0


def supervisor_from(request: Any) -> Any:
    """Get supervisor from app.state; fails outside the node process. Uses request.app.state."""
    supervisor = getattr(getattr(request.app, "state", None), "supervisor", None)
    if supervisor is None:
        raise ConflictError(
            "Este proceso no es el nodo, así que no puede manejar grupos. "
            "Los grupos se manejan desde el proceso del nodo.",
            code="not_the_node",
        )
    return supervisor


# ──────────────────────────────────────────────────────────────────────────────
# Ports
# ──────────────────────────────────────────────────────────────────────────────


async def _all_servers(session: Any) -> list[Server]:
    """All groups registered on this node."""
    servers, _ = await list_servers(session, limit=1000, offset=0)
    return servers


def _reserved_ports(servers: list[Server]) -> set[int]:
    """Ports held by registered groups, including inactive ones (port stays reserved)."""
    return {s.bind_port for s in servers if s.bind_port is not None}


async def _allocate_port(
    session: Any,
    supervisor: Any,
    *,
    preferred: int | None = None,
    ignoring: set[RecordId] | None = None,
) -> int | None:
    """Find a free group port, avoiding DB-registered and live-process ports."""
    servers = await _all_servers(session)
    skip = ignoring or set()
    taken = {s.bind_port for s in servers if s.bind_port is not None and s.id not in skip}
    taken |= supervisor.used_ports()

    return next_available_port(get_settings(), preferred=preferred, taken=taken)


# ──────────────────────────────────────────────────────────────────────────────
# Deploy/start/stop/delete
# ──────────────────────────────────────────────────────────────────────────────


async def create_group(session: Any, supervisor: Any, payload: ServerCreate) -> Server:
    """Deploy a group (deploy implies start). Marks active only after process is ready."""
    slug = normalize_slug(payload.slug)
    if not slug:
        raise ValidationDomainError(
            "El identificador del grupo no puede quedar vacío.",
            code="invalid_slug",
        )

    if await slug_taken(session, slug):
        raise ConflictError(
            f"El identificador '{slug}' ya está en uso.",
            code="slug_taken",
            extra={"slug": slug},
        )

    port = await _allocate_port(session, supervisor)
    if port is None:
        raise ConflictError(
            "No quedan puertos libres para un grupo más. "
            "Subí RECOP_GROUP_PORT_END en el .env si necesitás más.",
            code="no_free_port",
        )

    # Row built by servers.create_server to keep construction rules in one place.
    server = await servers_services.create_server(session, payload, port=port)

    await supervisor.spawn(server.id, port)
    ready = await supervisor.wait_ready(server.id, timeout_seconds=GROUP_READY_TIMEOUT_SECONDS)

    server.status = ServerStatus.ACTIVE if ready else ServerStatus.INACTIVE
    server.last_heartbeat_at = utcnow() if ready else None
    await session.flush()

    if ready:
        logger.info("grupo %s desplegado y escuchando en el puerto %s", slug, port)
    else:
        logger.error(
            "el grupo %s quedó registrado pero su proceso no levantó. "
            "Queda inactivo: se puede volver a encender desde el panel.",
            slug,
        )

    return server


async def start_group(session: Any, supervisor: Any, server_id: RecordId) -> Server:
    """Start a stopped group; already-running is a no-op."""
    server = await get_server(session, server_id)

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "Este grupo fue eliminado y no se puede volver a encender.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if supervisor.is_running(server_id):
        server.status = ServerStatus.ACTIVE
        server.last_heartbeat_at = utcnow()
        await session.flush()
        return server

    port = await _allocate_port(
        session, supervisor, preferred=server.bind_port, ignoring={server.id}
    )
    if port is None:
        raise ConflictError(
            "No queda ningún puerto libre para encender este grupo.",
            code="no_free_port",
        )

    await supervisor.spawn(server_id, port)
    ready = await supervisor.wait_ready(server_id, timeout_seconds=GROUP_READY_TIMEOUT_SECONDS)

    server.bind_port = port
    server.status = ServerStatus.ACTIVE if ready else ServerStatus.INACTIVE
    server.last_heartbeat_at = utcnow() if ready else None
    await session.flush()

    logger.info("grupo %s encendido en el puerto %s", server.slug, port)
    return server


async def stop_group(session: Any, supervisor: Any, server_id: RecordId) -> Server:
    """Stop a group without deleting data; port stays reserved."""
    server = await get_server(session, server_id)

    await supervisor.terminate(server_id)

    server.status = ServerStatus.INACTIVE
    await session.flush()

    logger.info("grupo %s apagado; sus datos siguen intactos", server.slug)
    return server


async def delete_group(session: Any, supervisor: Any, server_id: RecordId) -> None:
    """Permanently delete a group; terminate the process first to free the port."""
    server = await get_server(session, server_id)

    await supervisor.terminate(server_id)
    await session.delete(server)
    await session.flush()

    logger.info("grupo %s eliminado", server.slug)


# ──────────────────────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────────────────────


def process_state(supervisor: Any, server: Server) -> dict[str, object]:
    """Live process state for the panel; separate from DB status to surface crashes."""
    group = supervisor.status(server.id)

    if group is None:
        return {"running": False, "pid": None, "uptime_seconds": None, "exit_code": None}

    return {
        "running": group.is_running,
        "pid": group.pid,
        "uptime_seconds": round(group.uptime_seconds, 1) if group.is_running else None,
        "exit_code": group.returncode,
    }


def group_address(server: Server) -> dict[str, object]:
    """Shareable address for this group (group port + node host)."""
    addresses = local_addresses()
    recommended = addresses[0].host if addresses else None

    return {
        "slug": server.slug,
        "port": server.bind_port,
        # Host comes from node settings, not a group column.
        "host": get_settings().host,
        "is_reachable": server.status.accepts_traffic,
        "recommended_host": recommended,
        "address": f"{recommended}:{server.bind_port}" if recommended else None,
    }


def ensure_can_manage(actor_role: int, *, deleting: bool = False) -> None:
    """Only node owner manages groups; deleting requires OWNER."""
    if actor_role < Role.ADMIN:
        raise PermissionDeniedError(
            "Necesitás ser administrador para manejar los grupos del nodo.",
            code="not_admin",
        )
    if deleting and actor_role is not Role.OWNER:
        raise PermissionDeniedError(
            "Solo el dueño del nodo puede eliminar un grupo.",
            code="owner_required",
        )


__all__ = [
    "create_group",
    "delete_group",
    "ensure_can_manage",
    "group_address",
    "process_state",
    "start_group",
    "stop_group",
    "supervisor_from",
]


# ──────────────────────────────────────────────────────────────────────────────
# Node card
# ──────────────────────────────────────────────────────────────────────────────


def node_info() -> dict[str, object]:
    """Describe this process; queried first by clients."""
    from core import __version__

    settings = get_settings()
    return {
        "service": "recop-node",
        "version": __version__,
        "environment": settings.env,
        "bind_host": settings.host,
        "bind_port": settings.port,
        # Responding implies listening.
        "is_listening": True,
        "kafka_topic_prefix": settings.kafka_topic_prefix,
    }


def node_address() -> dict[str, object]:
    """Node process address: port plus reachable machine interfaces."""
    settings = get_settings()
    addresses = local_addresses()

    return {
        "port": settings.port,
        "bind_host": settings.host,
        "is_wildcard": settings.bind_host_is_wildcard,
        "candidates": addresses,
        "recommended": addresses[0].host if addresses else None,
        "group_port_range": {
            "first": settings.port + 1,
            "last": settings.group_port_end,
        },
    }
