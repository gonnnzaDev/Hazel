"""Stdlib-only local address resolution (0.0.0.0 is not connectable).

Returns all candidates instead of guessing one; single-IP guesses break on multi-NIC/VPN hosts.
"""

from __future__ import annotations

import socket
from ipaddress import ip_address
from typing import Literal

from pydantic import BaseModel

AddressFamily = Literal["ipv4", "ipv6"]


class LocalAddress(BaseModel):
    """Address the node may be reachable at."""

    host: str
    family: AddressFamily
    private: bool
    """Private LAN address; public ones are usually behind NAT."""

    loopback: bool = False
    """Loopback; local testing only."""


def _describe(raw: str) -> LocalAddress | None:
    """Classify an address; None when unusable."""
    try:
        parsed = ip_address(raw)
    except ValueError:
        return None

    family: AddressFamily = "ipv6" if parsed.version == 6 else "ipv4"

    return LocalAddress(
        host=str(parsed),
        family=family,
        private=parsed.is_private,
        loopback=parsed.is_loopback,
    )


def _hostname_addresses() -> list[str]:
    """Addresses the OS maps to this hostname."""
    try:
        hostname = socket.gethostname()
    except OSError:
        return []

    if not hostname:
        return []

    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        # Unresolvable hostname falls through to the fallback below.
        return []

    # Host is element 0 in both IPv4 and IPv6 sockaddrs.
    hosts: list[str] = []
    for info in infos:
        sockaddr = info[4]
        host = sockaddr[0] if sockaddr else ""
        if isinstance(host, str):
            hosts.append(host)
    return hosts


def local_addresses(*, include_loopback: bool = False) -> list[LocalAddress]:
    """Reachable addresses, sorted; stdlib-only with outbound-interface fallback."""
    candidates = [raw for raw in _hostname_addresses() if raw]

    if not candidates:
        candidates = _fallback_addresses()

    described: list[LocalAddress] = []
    seen: set[str] = set()
    for raw in candidates:
        address = _describe(raw)
        if address is None or address.host in seen:
            continue
        if address.loopback and not include_loopback:
            continue
        seen.add(address.host)
        described.append(address)

    described.sort(key=_sort_key)
    return described


def _fallback_addresses() -> list[str]:
    """Outbound-interface IP via a no-traffic UDP connect."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(0.2)
        # No traffic sent; connect only selects the route.
        sock.connect(("192.0.2.1", 9))  # TEST-NET-1, reserved and unroutable
        return [sock.getsockname()[0]]
    except OSError:
        return []
    finally:
        sock.close()


def _sort_key(address: LocalAddress) -> tuple[int, int, int]:
    """Private IPv4 > private IPv6 > public > loopback; stable by IP value."""
    if address.loopback:
        priority = 3
    elif address.private:
        priority = 0 if address.family == "ipv4" else 1
    else:
        priority = 2

    try:
        numeric = int(ip_address(address.host))
    except ValueError:  # pragma: no cover - _describe already filtered invalid ones
        numeric = 0

    return (priority, 0 if address.family == "ipv4" else 1, numeric)
