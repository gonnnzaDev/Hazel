"""Node persistence helpers; process orchestration lives in `node.service`."""

from __future__ import annotations

from typing import Any

from servers.model import Server
from servers.repository import list_servers


async def all_servers(session: Any) -> list[Server]:
    """All groups registered on this node."""
    servers, _ = await list_servers(session, limit=1000, offset=0)
    return servers


def reserved_ports(servers: list[Server]) -> set[int]:
    """Ports held by registered groups, including inactive ones (port stays reserved)."""
    return {s.bind_port for s in servers if s.bind_port is not None}
