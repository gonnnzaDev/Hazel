from __future__ import annotations

import socket
from ipaddress import ip_address
from typing import Literal

from pydantic import BaseModel

AddressFamily = Literal["ipv4", "ipv6"]


class LocalAddress(BaseModel):

    host: str
    family: AddressFamily
    private: bool

    loopback: bool = False


def _describe(raw: str) -> LocalAddress | None:
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
    try:
        hostname = socket.gethostname()
    except OSError:
        return []

    if not hostname:
        return []

    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        return []

    hosts: list[str] = []
    for info in infos:
        sockaddr = info[4]
        host = sockaddr[0] if sockaddr else ""
        if isinstance(host, str):
            hosts.append(host)
    return hosts


def local_addresses(*, include_loopback: bool = False) -> list[LocalAddress]:
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
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(0.2)
        sock.connect(("192.0.2.1", 9))
        return [sock.getsockname()[0]]
    except OSError:
        return []
    finally:
        sock.close()


def _sort_key(address: LocalAddress) -> tuple[int, int, int]:
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
