from __future__ import annotations

from enum import IntEnum


class Role(IntEnum):
    MEMBER = 10

    ADMIN = 50

    OWNER = 100

    @property
    def label(self) -> str:
        return self.name.lower()

    @property
    def can_administer(self) -> bool:
        return self >= Role.ADMIN

    @property
    def can_delete_server(self) -> bool:
        return self is Role.OWNER

    @classmethod
    def from_label(cls, label: str) -> Role:
        try:
            return cls[label.upper()]
        except KeyError:
            raise ValueError(f"Unknown role: {label!r}") from None


DEFAULT_ROLE = Role.MEMBER
