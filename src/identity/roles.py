"""Three-level roles; owner is immutable. No granular permissions in v1."""

from __future__ import annotations

from enum import IntEnum


class Role(IntEnum):
    """Member role within a server. IntEnum so ordering gives hierarchy checks."""

    MEMBER = 10
    """Can chat; default on join."""

    ADMIN = 50
    """Can manage channels/members; cannot delete server."""

    OWNER = 100
    """Full control including delete; immutable via API."""

    @property
    def label(self) -> str:
        return self.name.lower()

    @property
    def can_administer(self) -> bool:
        """Whether it grants server administration."""
        return self >= Role.ADMIN

    @property
    def can_delete_server(self) -> bool:
        """Whether it can delete the server (owner only)."""
        return self is Role.OWNER

    @classmethod
    def from_label(cls, label: str) -> Role:
        """Convert API label (e.g. "admin") to Role."""
        try:
            return cls[label.upper()]
        except KeyError:
            raise ValueError(f"Rol desconocido: {label!r}") from None


#: Server must always keep an owner; see service.kick_member.
DEFAULT_ROLE = Role.MEMBER
