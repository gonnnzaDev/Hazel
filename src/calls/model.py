from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

PeerSend = Callable[[dict[str, object]], Awaitable[None]]


@dataclass(slots=True)
class Peer:
    member_id: str
    nickname: str
    display_name: str
    mic_on: bool = True
    cam_on: bool = False
    send: PeerSend | None = None

    def public(self) -> dict[str, object]:
        return {
            "member_id": self.member_id,
            "nickname": self.nickname,
            "display_name": self.display_name,
            "mic": self.mic_on,
            "cam": self.cam_on,
        }


@dataclass(slots=True)
class Room:
    channel_id: str
    peers: dict[str, Peer] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.peers
