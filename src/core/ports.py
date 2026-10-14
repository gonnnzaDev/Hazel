"""One port per group process (isolation: a hung group can't take others down).

Reuse the assigned port when free; else first free port in range, checked against DB and OS.
"""

from __future__ import annotations

import contextlib
import socket

from core.config import Settings

#: Probe timeout for free-port checks.
#: BIND (not connect): bind fails when taken, which is the signal we need.
_PROBE_TIMEOUT = 0.2


def is_port_free(port: int, host: str = "0.0.0.0") -> bool:  # noqa: S104
    """True if the port is free on this machine (ignores DB reservations)."""
    if not 1 <= port <= 65535:
        return False

    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        # SO_REUSEADDR only skips own TIME_WAIT; never skips another process's bind.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(_PROBE_TIMEOUT)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def port_range(settings: Settings) -> range:
    """Ports this node may assign; starts at RECOP_PORT + 1 (node owns RECOP_PORT)."""
    first = settings.port + 1
    last = settings.group_port_end
    if last < first:
        return range(0)
    return range(first, last + 1)


def next_available_port(
    settings: Settings,
    *,
    preferred: int | None = None,
    taken: set[int] | None = None,
) -> int | None:
    """First free port in range; taken is passed in to stay pure/DB-free."""
    used = taken or set()
    candidates = port_range(settings)

    if (
        preferred is not None
        and preferred in candidates
        and preferred not in used
        and is_port_free(preferred, settings.host)
    ):
        return preferred

    for port in candidates:
        if port in used:
            continue
        if is_port_free(port, settings.host):
            return port

    return None
