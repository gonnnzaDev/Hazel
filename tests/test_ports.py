"""Tests de la asignación de puertos.

Cada grupo corre en su propio proceso, con su propio puerto. Esto es lo que
permite que un grupo que se cuelga no se lleve por delante a los demás, y lo que
hace que el dueño comparta una dirección distinta por grupo.

La función es pura salvo por la comprobación de puertos del sistema, que va
monkeypatcheada en todos los tests: no se abre ningún puerto real.
"""

from __future__ import annotations

import pytest

from core.config import Settings
from core.ports import is_port_free, next_available_port, port_range


@pytest.fixture
def settings() -> Settings:  # type: ignore[misc]
    """Config con un rango chico y conocido."""
    return Settings(  # type: ignore[call-arg]
        secret_key="test",
        port=7272,
        group_port_end=7275,
        host="127.0.0.1",
    )


@pytest.fixture(autouse=True)
def _all_ports_free(monkeypatch: pytest.MonkeyPatch) -> None:
    """Por default, todos los puertos están libres."""
    monkeypatch.setattr("core.ports.is_port_free", lambda port, host="0.0.0.0": True)


class TestPortRange:
    def test_starts_after_the_node_port(self, settings: Settings) -> None:
        """El proceso del nodo ya usa `RECOP_PORT`: los grupos empiezan después."""
        assert port_range(settings) == range(7273, 7276)

    def test_empty_when_end_is_before_start(self) -> None:
        """Una configuración mal puesta no cuelga: devuelve rango vacío."""
        bad = Settings(secret_key="t", port=7400, group_port_end=1024, host="127.0.0.1")  # type: ignore[call-arg]
        assert list(port_range(bad)) == []

    def test_can_be_wider_than_the_default(self) -> None:
        wide = Settings(secret_key="t", port=7272, group_port_end=9000, host="127.0.0.1")  # type: ignore[call-arg]
        assert len(port_range(wide)) == 9000 - 7272


class TestNextAvailablePort:
    def test_returns_first_free_when_none_taken(self, settings: Settings) -> None:
        assert next_available_port(settings) == 7273

    def test_skips_taken_ports(self, settings: Settings) -> None:
        assert next_available_port(settings, taken={7273, 7274}) == 7275

    def test_skips_ports_the_system_is_using(
        self, settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Un puerto tomado por un programa que no es nuestro también cuenta."""
        monkeypatch.setattr("core.ports.is_port_free", lambda port, host="0.0.0.0": port != 7273)
        assert next_available_port(settings) == 7274

    def test_reuses_preferred_port_if_free(self, settings: Settings) -> None:
        """Un grupo que ya tenía puerto lo vuelve a usar si sigue libre.

        Es lo que quiere el dueño: apagar y reencender no debería cambiarle la
        dirección que ya le compartió a sus amigos.
        """
        assert next_available_port(settings, preferred=7274) == 7274

    def test_ignores_preferred_if_taken_by_another_group(self, settings: Settings) -> None:
        """Si otro grupo ya tomó ese puerto, se busca otro."""
        assert next_available_port(settings, preferred=7273, taken={7273}) == 7274

    def test_ignores_preferred_outside_the_range(self, settings: Settings) -> None:
        """Un puerto fuera del rango configurado no se usa."""
        assert next_available_port(settings, preferred=9999) == 7273

    def test_returns_none_when_range_is_exhausted(
        self, settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Sin puertos libres se devuelve `None`, no un puerto que va a fallar.

        El service lo traduce a un error que dice qué hacer: subir
        `RECOP_GROUP_PORT_END`.
        """
        monkeypatch.setattr("core.ports.is_port_free", lambda port, host="0.0.0.0": False)
        assert next_available_port(settings) is None

    def test_combines_registry_and_system(
        self, settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Las dos fuentes de conflicto se suman.

        La base evita que dos grupos del mismo nodo choquen; el sistema evita
        que el nodo no arranque porque el puerto lo tiene otro programa.
        """
        monkeypatch.setattr("core.ports.is_port_free", lambda port, host="0.0.0.0": port > 7274)
        assert next_available_port(settings, taken={7273}) == 7275


class TestIsPortFree:
    def test_rejects_out_of_range(self) -> None:
        assert is_port_free(0) is False
        assert is_port_free(70000) is False

    def test_a_bound_port_is_not_free(self) -> None:
        """Una comprobación real: ocupa un puerto y lo vuelve a chequear."""
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            port = sock.getsockname()[1]

            assert is_port_free(port, "127.0.0.1") is False

    def test_an_unused_port_is_free(self) -> None:
        import socket

        # Se pide un puerto efímero al sistema y se cierra: queda libre.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        assert is_port_free(port, "127.0.0.1") is True
