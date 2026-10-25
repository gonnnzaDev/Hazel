from __future__ import annotations

from enum import StrEnum


class ServerStatus(StrEnum):
    CREATING = "creating"

    ACTIVE = "active"

    INACTIVE = "inactive"

    DELETED = "deleted"

    @property
    def accepts_traffic(self) -> bool:
        return self is ServerStatus.ACTIVE

    @property
    def is_terminal(self) -> bool:
        return self is ServerStatus.DELETED


TRANSITIONS: dict[ServerStatus, frozenset[ServerStatus]] = {
    ServerStatus.CREATING: frozenset(
        {ServerStatus.ACTIVE, ServerStatus.INACTIVE, ServerStatus.DELETED}
    ),
    ServerStatus.ACTIVE: frozenset({ServerStatus.INACTIVE, ServerStatus.DELETED}),
    ServerStatus.INACTIVE: frozenset({ServerStatus.ACTIVE, ServerStatus.DELETED}),
    ServerStatus.DELETED: frozenset(),
}


def can_transition(current: ServerStatus, target: ServerStatus) -> bool:
    return target in TRANSITIONS.get(current, frozenset())


def next_states(current: ServerStatus) -> frozenset[ServerStatus]:
    return TRANSITIONS.get(current, frozenset())
