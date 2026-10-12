"""Tests del grafo de estados del servidor.

No tocan la base: son la red de seguridad que dice qué transiciones tienen
sentido. Si alguien agrega un estado nuevo, esta suite le avisa.
"""

from __future__ import annotations

import pytest

from apps.servers.states import TRANSITIONS, ServerStatus, can_transition, next_states


class TestStatusProperties:
    def test_only_active_accepts_traffic(self) -> None:
        """El estado que decide si el puerto escucha."""
        assert ServerStatus.ACTIVE.accepts_traffic is True

        for status in ServerStatus:
            if status is not ServerStatus.ACTIVE:
                assert status.accepts_traffic is False, f"{status} no debería aceptar tráfico"

    def test_only_deleted_is_terminal(self) -> None:
        assert ServerStatus.DELETED.is_terminal is True
        assert ServerStatus.ACTIVE.is_terminal is False

    def test_all_states_are_lowercase_strings(self) -> None:
        """El valor del enum es lo que va a la base y a la API."""
        for status in ServerStatus:
            assert status.value == status.value.lower()
            assert " " not in status.value


class TestTransitions:
    @pytest.mark.parametrize(
        ("current", "target"),
        [
            (ServerStatus.CREATING, ServerStatus.ACTIVE),
            (ServerStatus.CREATING, ServerStatus.INACTIVE),
            (ServerStatus.ACTIVE, ServerStatus.INACTIVE),
            (ServerStatus.INACTIVE, ServerStatus.ACTIVE),
            # Borrar es válido desde cualquier estado no terminal.
            (ServerStatus.ACTIVE, ServerStatus.DELETED),
            (ServerStatus.INACTIVE, ServerStatus.DELETED),
            (ServerStatus.CREATING, ServerStatus.DELETED),
        ],
    )
    def test_allowed(self, current: ServerStatus, target: ServerStatus) -> None:
        assert can_transition(current, target) is True

    @pytest.mark.parametrize(
        ("current", "target"),
        [
            # No tiene sentido "volver a estar activo" cuando ya lo está.
            (ServerStatus.ACTIVE, ServerStatus.ACTIVE),
            # Nunca se resurrecta un servidor borrado.
            (ServerStatus.DELETED, ServerStatus.ACTIVE),
            (ServerStatus.DELETED, ServerStatus.INACTIVE),
            # No tiene sentido "volver a estar borrado".
            (ServerStatus.DELETED, ServerStatus.DELETED),
        ],
    )
    def test_rejected(self, current: ServerStatus, target: ServerStatus) -> None:
        assert can_transition(current, target) is False

    def test_dead_end_has_no_next_states(self) -> None:
        assert next_states(ServerStatus.DELETED) == frozenset()

    def test_every_state_has_an_entry(self) -> None:
        """Si se agrega un estado sin registrarlo en el mapa, esto falla."""
        for status in ServerStatus:
            assert status in TRANSITIONS, f"{status} no está en el mapa de transiciones"

    def test_all_targets_are_known_states(self) -> None:
        for targets in TRANSITIONS.values():
            for target in targets:
                assert isinstance(target, ServerStatus)


class TestLifecycleRoundTrip:
    def test_deactivate_then_activate_always_works(self) -> None:
        """El ciclo que el dueño repite todo el tiempo tiene que ser legal."""
        for state in (ServerStatus.CREATING, ServerStatus.ACTIVE):
            assert can_transition(state, ServerStatus.INACTIVE)
            assert can_transition(ServerStatus.INACTIVE, ServerStatus.ACTIVE)

    def test_every_non_terminal_state_can_be_deleted(self) -> None:
        """El dueño puede borrar su servidor esté como esté."""
        for state in ServerStatus:
            if state.is_terminal:
                continue
            assert can_transition(state, ServerStatus.DELETED)
