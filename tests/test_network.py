"""Tests de resolución de direcciones de red.

El dueño tiene que compartir `ip:puerto`, y el nodo escucha en `0.0.0.0`, que
no es una dirección conectable. Estos tests fijan cómo se resuelve eso.

No necesitan red: todos los casos se simulan.
"""

from __future__ import annotations

import pytest

from core import network
from core.network import local_addresses


class TestDescribe:
    @pytest.mark.parametrize(
        ("raw", "family", "private", "loopback"),
        [
            ("192.168.1.50", "ipv4", True, False),
            ("10.0.0.1", "ipv4", True, False),
            ("8.8.8.8", "ipv4", False, False),
            ("127.0.0.1", "ipv4", True, True),
            ("fe80::1", "ipv6", True, False),
            ("2001:4860:4860::8888", "ipv6", False, False),
        ],
    )
    def test_classifies_addresses(
        self, raw: str, family: str, private: bool, loopback: bool
    ) -> None:
        address = network._describe(raw)

        assert address is not None
        assert address.family == family
        assert address.private is private
        assert address.loopback is loopback

    def test_rejects_garbage(self) -> None:
        assert network._describe("no-es-una-ip") is None
        assert network._describe("") is None


class TestLocalAddresses:
    def test_orders_private_ipv4_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Las direcciones privadas IPv4 van antes que todo lo demás.

        Son las que sirven para un grupo de amigos en la misma red, así que van
        primero. Dentro de ese grupo el orden es por valor de IP, no una
        preferencia: ver `test_order_is_deterministic`.
        """
        monkeypatch.setattr(
            network,
            "_hostname_addresses",
            lambda: ["8.8.8.8", "fe80::1", "192.168.1.50", "10.0.0.2"],
        )

        hosts = [a.host for a in local_addresses()]

        # Ambas privadas IPv4 van antes que la pública y la IPv6.
        assert hosts.index("10.0.0.2") < hosts.index("8.8.8.8")
        assert hosts.index("10.0.0.2") < hosts.index("fe80::1")
        assert set(hosts[:2]) == {"10.0.0.2", "192.168.1.50"}

    def test_order_is_deterministic(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """El orden no depende del orden en que el sistema las devuelva.

        Dentro de un mismo grupo se ordena por valor de IP, no por el orden de
        llegada. Un cliente que cachea la dirección no puede ver la dirección
        cambiar entre dos llamadas.
        """
        a = ["192.168.1.50", "10.0.0.2"]
        b = ["10.0.0.2", "192.168.1.50"]

        monkeypatch.setattr(network, "_hostname_addresses", lambda: a)
        primero = [x.host for x in local_addresses()]
        monkeypatch.setattr(network, "_hostname_addresses", lambda: b)
        segundo = [x.host for x in local_addresses()]

        assert primero == segundo == ["10.0.0.2", "192.168.1.50"]

    def test_excludes_loopback_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Loopback no sirve para Invite a alguien más."""
        monkeypatch.setattr(network, "_hostname_addresses", lambda: ["127.0.0.1", "192.168.1.50"])

        hosts = [a.host for a in local_addresses()]

        assert "127.0.0.1" not in hosts
        assert hosts == ["192.168.1.50"]

    def test_can_include_loopback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(network, "_hostname_addresses", lambda: ["127.0.0.1", "192.168.1.50"])

        hosts = [a.host for a in local_addresses(include_loopback=True)]

        assert "127.0.0.1" in hosts

    def test_deduplicates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Un hostname puede devolver la misma IP varias veces."""
        monkeypatch.setattr(
            network, "_hostname_addresses", lambda: ["192.168.1.50", "192.168.1.50", "192.168.1.50"]
        )

        hosts = [a.host for a in local_addresses()]

        assert hosts == ["192.168.1.50"]

    def test_ignores_unparseable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(network, "_hostname_addresses", lambda: ["basura", "192.168.1.50"])

        hosts = [a.host for a in local_addresses()]

        assert hosts == ["192.168.1.50"]

    def test_falls_back_when_hostname_resolves_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Si el hostname no da nada, se usa la IP de la interfaz de salida."""
        monkeypatch.setattr(network, "_hostname_addresses", lambda: [])
        monkeypatch.setattr(network, "_fallback_addresses", lambda: ["172.17.0.2"])

        hosts = [a.host for a in local_addresses()]

        assert hosts == ["172.17.0.2"]

    def test_returns_empty_when_nothing_resolves(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Una máquina sin interfaces no debe romper el endpoint.

        Devuelve una lista vacía y el cliente muestra un mensaje útil en vez
        de un 500.
        """
        monkeypatch.setattr(network, "_hostname_addresses", lambda: [])
        monkeypatch.setattr(network, "_fallback_addresses", lambda: [])

        assert local_addresses() == []


class TestHostnameAddresses:
    def test_handles_oserror(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import socket

        def boom() -> str:
            raise OSError("no hay hostname")

        monkeypatch.setattr(socket, "gethostname", boom)

        assert network._hostname_addresses() == []

    def test_handles_empty_hostname(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import socket

        monkeypatch.setattr(socket, "gethostname", lambda: "")

        assert network._hostname_addresses() == []

    def test_handles_gaierror(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import socket

        monkeypatch.setattr(socket, "gethostname", lambda: "host-inexistente")
        monkeypatch.setattr(
            socket, "getaddrinfo", lambda *a, **k: (_ for _ in ()).throw(socket.gaierror())
        )

        assert network._hostname_addresses() == []


class TestSortKey:
    def test_priority_order(self) -> None:
        """Loopback va al final: nunca es la dirección para compartir."""
        from core.network import LocalAddress

        privada = LocalAddress(host="192.168.1.1", family="ipv4", private=True)
        publica = LocalAddress(host="8.8.8.8", family="ipv4", private=False)
        loopback = LocalAddress(host="127.0.0.1", family="ipv4", private=True, loopback=True)

        ordenadas = sorted([loopback, publica, privada], key=network._sort_key)

        assert [a.host for a in ordenadas] == ["192.168.1.1", "8.8.8.8", "127.0.0.1"]
