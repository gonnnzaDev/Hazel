from __future__ import annotations

import logging
from typing import Any

from common.types import RecordId, utcnow
from config.conf import get_settings
from core.api.errors import ConflictError, PermissionDeniedError, ValidationDomainError
from core.network import local_addresses
from core.ports import next_available_port
from identity.roles import Role
from node import repository
from servers import service as servers_service
from servers.model import Server
from servers.schemas import ServerCreate
from servers.states import ServerStatus

logger = logging.getLogger(__name__)

GROUP_READY_TIMEOUT_SECONDS = 20.0


def supervisor_from(request: Any) -> Any:
    supervisor = getattr(getattr(request.app, "state", None), "supervisor", None)
    if supervisor is None:
        raise ConflictError(
            "This process is not the node, so it cannot manage groups. "
            "Groups are managed from the node process.",
            code="not_the_node",
        )
    return supervisor


async def _allocate_port(
    session: Any,
    supervisor: Any,
    *,
    preferred: int | None = None,
    ignoring: set[RecordId] | None = None,
) -> int | None:
    servers = await repository.all_servers(session)
    skip = ignoring or set()
    taken = {s.bind_port for s in servers if s.bind_port is not None and s.id not in skip}
    taken |= supervisor.used_ports()

    return next_available_port(get_settings(), preferred=preferred, taken=taken)


async def create_group(session: Any, supervisor: Any, payload: ServerCreate) -> Server:
    slug = servers_service.normalize_slug(payload.slug)
    if not slug:
        raise ValidationDomainError(
            "The group identifier cannot be empty.",
            code="invalid_slug",
        )

    if await servers_service.slug_taken(session, slug):
        raise ConflictError(
            f"The identifier '{slug}' is already in use.",
            code="slug_taken",
            extra={"slug": slug},
        )

    port = await _allocate_port(session, supervisor)
    if port is None:
        raise ConflictError(
            "No free ports left for another group. "
            "Raise HAZEL_GROUP_PORT_END in the .env if you need more.",
            code="no_free_port",
        )

    server = await servers_service.create_server(session, payload, port=port)

    await supervisor.spawn(server.id, port)
    ready = await supervisor.wait_ready(server.id, timeout_seconds=GROUP_READY_TIMEOUT_SECONDS)

    server.status = ServerStatus.ACTIVE if ready else ServerStatus.INACTIVE
    server.last_heartbeat_at = utcnow() if ready else None
    await session.flush()

    if ready:
        logger.info("group %s deployed and listening on port %s", slug, port)
    else:
        logger.error(
            "group %s was registered but its process did not start. "
            "It stays inactive: it can be started again from the panel.",
            slug,
        )

    return server


async def start_group(session: Any, supervisor: Any, server_id: RecordId) -> Server:
    from servers.repository import get_server

    server = await get_server(session, server_id)

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "This group was deleted and cannot be started again.",
            code="server_deleted",
            extra={"server_id": str(server_id)},
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
            "No free port left to start this group.",
            code="no_free_port",
        )

    await supervisor.spawn(server_id, port)
    ready = await supervisor.wait_ready(server_id, timeout_seconds=GROUP_READY_TIMEOUT_SECONDS)

    server.bind_port = port
    server.status = ServerStatus.ACTIVE if ready else ServerStatus.INACTIVE
    server.last_heartbeat_at = utcnow() if ready else None
    await session.flush()

    logger.info("group %s started on port %s", server.slug, port)
    return server


async def stop_group(session: Any, supervisor: Any, server_id: RecordId) -> Server:
    from servers.repository import get_server

    server = await get_server(session, server_id)

    await supervisor.terminate(server_id)

    server.status = ServerStatus.INACTIVE
    await session.flush()

    logger.info("group %s stopped; its data remains intact", server.slug)
    return server


async def delete_group(session: Any, supervisor: Any, server_id: RecordId) -> None:
    from servers.repository import get_server

    server = await get_server(session, server_id)

    await supervisor.terminate(server_id)
    await session.delete(server)
    await session.flush()

    logger.info("group %s deleted", server.slug)


def process_state(supervisor: Any, server: Server) -> dict[str, object]:
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
    settings = get_settings()
    addresses = local_addresses()
    recommended = addresses[0].host if addresses else None

    return {
        "slug": server.slug,
        "port": server.bind_port,
        "bind_host": settings.host,
        "is_reachable": server.status.accepts_traffic,
        "recommended_host": recommended,
        "address": f"{recommended}:{server.bind_port}" if recommended else None,
    }


def ensure_can_manage(actor_role: int, *, deleting: bool = False) -> None:
    if actor_role < Role.ADMIN:
        raise PermissionDeniedError(
            "You must be an administrator to manage the node's groups.",
            code="not_admin",
        )
    if deleting and actor_role is not Role.OWNER:
        raise PermissionDeniedError(
            "Only the node owner can delete a group.",
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


def node_info() -> dict[str, object]:
    from core import __version__

    settings = get_settings()
    return {
        "service": "hazel-node",
        "version": __version__,
        "environment": settings.env,
        "bind_host": settings.host,
        "bind_port": settings.port,
        "is_listening": True,
        "kafka_topic_prefix": settings.kafka_topic_prefix,
    }


def node_address() -> dict[str, object]:
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
