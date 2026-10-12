"""Resolución de direcciones de red, sin dependencias externas.

El dueño tiene que compartir `ip:puerto` con sus invitados, pero el nodo escucha
en `0.0.0.0`, que es un comodín: no se puede conectar a `0.0.0.0`.

Este módulo resuelve la IP real de la máquina usando solo la biblioteca estándar,
para que funcione igual en Linux, macOS, Windows y Android (Termux) sin pedirle
una dependencia nativa al usuario.

## Por qué no se adivina una sola IP

Un nodo puede tener VPN, docker, o tres placas de red. Elegir una sola IP y
mostrarla como si fuera la correcta es peor que mostrar todas las candidatas y
dejar que el dueño o su cliente elijan. Por eso `local_addresses()` devuelve una
lista y no un valor.
"""

from __future__ import annotations

import socket
from ipaddress import ip_address
from typing import Literal

from pydantic import BaseModel

AddressFamily = Literal["ipv4", "ipv6"]


class LocalAddress(BaseModel):
    """Una dirección por la que el nodo puede ser alcanzado."""

    host: str
    family: AddressFamily
    private: bool
    """Si es una dirección privada de red local.

    Las privadas (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) son las que sirven
    para un grupo de amigos en la misma red. Las públicas casi nunca están
    expuestas y están detrás de un router.
    """

    loopback: bool = False
    """`127.0.0.1` o `::1`. Sirve solo para pruebas locales."""


def _describe(raw: str) -> LocalAddress | None:
    """Clasifica una dirección. Devuelve None si no es usable."""
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
    """Direcciones que el sistema asocia al hostname de la máquina."""
    try:
        hostname = socket.gethostname()
    except OSError:
        return []

    if not hostname:
        return []

    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        # Si el hostname no resuelve, se cae al fallback de abajo.
        return []

    # sockaddr_ipv4 es (host, port, ...) y sockaddr_ipv6 tiene más campos. En
    # ambos casos el host es el primer elemento.
    hosts: list[str] = []
    for info in infos:
        sockaddr = info[4]
        host = sockaddr[0] if sockaddr else ""
        if isinstance(host, str):
            hosts.append(host)
    return hosts


def local_addresses(*, include_loopback: bool = False) -> list[LocalAddress]:
    """Direcciones por las que el nodo puede ser alcanzado, ordenadas.

    El orden es: privadas IPv4 primero (las que sirven para un grupo de amigos
    en la misma red), después IPv6, y al final loopback.

    Usa `socket.getaddrinfo` con el hostname de la máquina: funciona en las cuatro
    plataformas sin dependencias nativas. No enumera todas las interfaces del
    sistema — para eso haría falta `psutil` o `netifaces`, y una dependencia
    nativa en un proyecto que se tiene que instalar en un celular no vale la
    pena. Cuando `getaddrinfo` no devuelve nada, se cae a la ruta que devuelve
    la IP de la interfaz de salida.
    """
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
    """Dirección de la interfaz de salida, cuando el hostname no resuelve.

    Se conecta un socket UDP sin enviar nada: el sistema elige la ruta pero no
    se genera tráfico. Es el truco estándar para "cuál es mi IP" sin depender de
    un servicio externo.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(0.2)
        # No se envía nada: solo se abre la conexión para que el SO elija la ruta.
        sock.connect(("192.0.2.1", 9))  # TEST-NET-1, reservado y no enrutable
        return [sock.getsockname()[0]]
    except OSError:
        return []
    finally:
        sock.close()


def _sort_key(address: LocalAddress) -> tuple[int, int, int]:
    """Ordena: IPv4 privada > IPv6 privada > pública > loopback.

    Dentro de un mismo grupo el orden es por valor de IP, que es estable y
    determinista. **No** se intenta adivinar cuál interfaz es la mejor: eso no se
    puede saber sin enumerar las interfaces, y equivocarse es peor que mostrar
    todas. Para eso está `candidates`; `recommended` es solo el primer elemento.
    """
    if address.loopback:
        priority = 3
    elif address.private:
        priority = 0 if address.family == "ipv4" else 1
    else:
        priority = 2

    try:
        numeric = int(ip_address(address.host))
    except ValueError:  # pragma: no cover - _describe ya filtró las inválidas
        numeric = 0

    return (priority, 0 if address.family == "ipv4" else 1, numeric)
