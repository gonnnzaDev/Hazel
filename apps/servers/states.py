"""Server lifecycle states.

INACTIVE keeps all data; deletion is synchronous so there is no DELETING state.
"""

from __future__ import annotations

from enum import StrEnum


class ServerStatus(StrEnum):
    """Server lifecycle."""

    CREATING = "creating"
    """Being set up; accepts no traffic."""

    ACTIVE = "active"
    """Running; port open, accepts connections."""

    INACTIVE = "inactive"
    """Stopped or crashed; keeps all data."""

    DELETED = "deleted"
    """Owner-deleted; terminal."""

    @property
    def accepts_traffic(self) -> bool:
        """Whether the server can serve connections."""
        return self is ServerStatus.ACTIVE

    @property
    def is_terminal(self) -> bool:
        """Whether no further transitions are possible."""
        return self is ServerStatus.DELETED


#: Valid lifecycle transitions (no ACTIVE -> ACTIVE: re-activating is a service-level no-op).
TRANSITIONS: dict[ServerStatus, frozenset[ServerStatus]] = {
    ServerStatus.CREATING: frozenset(
        {ServerStatus.ACTIVE, ServerStatus.INACTIVE, ServerStatus.DELETED}
    ),
    ServerStatus.ACTIVE: frozenset({ServerStatus.INACTIVE, ServerStatus.DELETED}),
    ServerStatus.INACTIVE: frozenset({ServerStatus.ACTIVE, ServerStatus.DELETED}),
    ServerStatus.DELETED: frozenset(),
}


def can_transition(current: ServerStatus, target: ServerStatus) -> bool:
    """Whether `current` may move to `target`."""
    return target in TRANSITIONS.get(current, frozenset())


def next_states(current: ServerStatus) -> frozenset[ServerStatus]:
    """States reachable from `current`."""
    return TRANSITIONS.get(current, frozenset())
