from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

PeerSend = Callable[[dict[str, object]], Awaitable[None]]

_FORWARDED = frozenset({"offer", "answer", "ice"})


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


class CallManager:

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def join(self, channel_id: str, peer: Peer) -> list[Peer]:
        async with self._lock:
            room = self._rooms.setdefault(channel_id, Room(channel_id=channel_id))
            existing = [p for mid, p in room.peers.items() if mid != peer.member_id]
            room.peers[peer.member_id] = peer
        logger.info(
            "call %s: join %s (%d present)", channel_id, peer.nickname, len(existing) + 1
        )
        return existing

    async def leave(self, channel_id: str, member_id: str) -> list[Peer]:
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return []
            room.peers.pop(member_id, None)
            remaining = list(room.peers.values())
            if room.is_empty:
                del self._rooms[channel_id]
        logger.info("call %s: leave %s (%d remaining)", channel_id, member_id, len(remaining))
        return remaining

    async def set_state(
        self, channel_id: str, member_id: str, *, mic: bool, cam: bool
    ) -> Peer | None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None
            if peer is not None:
                peer.mic_on = mic
                peer.cam_on = cam
        return peer

    async def send_to(self, channel_id: str, member_id: str, message: dict[str, object]) -> bool:
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None

        if peer is None or peer.send is None:
            return False
        return await _safe_send(peer, message)

    async def broadcast(
        self, channel_id: str, message: dict[str, object], *, exclude: str | None = None
    ) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            targets = (
                [p for mid, p in room.peers.items() if mid != exclude] if room is not None else []
            )

        for peer in targets:
            await _safe_send(peer, message)

    def snapshot(self, channel_id: str) -> list[dict[str, object]]:
        room = self._rooms.get(channel_id)
        if room is None:
            return []
        return [peer.public() for peer in room.peers.values()]

    def count(self, channel_id: str) -> int:
        room = self._rooms.get(channel_id)
        return len(room.peers) if room is not None else 0

    async def reset(self) -> None:
        async with self._lock:
            self._rooms.clear()


async def _safe_send(peer: Peer, message: dict[str, object]) -> bool:
    if peer.send is None:
        return False
    try:
        await peer.send(message)
    except Exception:
        logger.debug("could not send to %s; connection probably closed", peer.member_id)
        return False
    return True


def parse_signal(raw: str) -> dict[str, object] | None:
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def message_kind(message: dict[str, object]) -> str | None:
    kind = message.get("type")
    return kind if isinstance(kind, str) else None


def is_forwardable(kind: str) -> bool:
    return kind in _FORWARDED


call_manager = CallManager()
