from __future__ import annotations

from typing import Any

from servers.model import Server
from servers.repository import list_servers


async def all_servers(session: Any) -> list[Server]:
    servers, _ = await list_servers(session, limit=1000, offset=0)
    return servers


def reserved_ports(servers: list[Server]) -> set[int]:
    return {s.bind_port for s in servers if s.bind_port is not None}
