"""In-process WebRTC signaling (SDP/ICE relay plus room state).

No media flows here; peers connect directly. State is in-memory per process.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

#: Per-peer sender (e.g. `websocket.send_json`); a callback keeps this layer FastAPI-free.
PeerSend = Callable[[dict[str, object]], Awaitable[None]]

#: Peer-to-peer message types relayed verbatim; the payload is opaque to the server.
_FORWARDED = frozenset({"offer", "answer", "ice"})


@dataclass(slots=True)
class Peer:
    """A participant connected to a call (in-memory view, not a DB row)."""

    member_id: str
    nickname: str
    display_name: str
    mic_on: bool = True
    cam_on: bool = False
    send: PeerSend | None = None

    def public(self) -> dict[str, object]:
        """Public view of the participant (excludes transport)."""
        return {
            "member_id": self.member_id,
            "nickname": self.nickname,
            "display_name": self.display_name,
            "mic": self.mic_on,
            "cam": self.cam_on,
        }


@dataclass(slots=True)
class Room:
    """An active call: participants connected to a channel."""

    channel_id: str
    peers: dict[str, Peer] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.peers


class CallManager:
    """Call state for this process. One lock guards mutations; network sends happen outside it."""

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def join(self, channel_id: str, peer: Peer) -> list[Peer]:
        """Register a peer; return existing peers so the newcomer can offer connections."""
        async with self._lock:
            room = self._rooms.setdefault(channel_id, Room(channel_id=channel_id))
            existing = [p for mid, p in room.peers.items() if mid != peer.member_id]
            room.peers[peer.member_id] = peer
        logger.info(
            "llamada %s: entra %s (%d presentes)", channel_id, peer.nickname, len(existing) + 1
        )
        return existing

    async def leave(self, channel_id: str, member_id: str) -> list[Peer]:
        """Remove a peer; drop the room when empty."""
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return []
            room.peers.pop(member_id, None)
            remaining = list(room.peers.values())
            if room.is_empty:
                del self._rooms[channel_id]
        logger.info("llamada %s: sale %s (quedan %d)", channel_id, member_id, len(remaining))
        return remaining

    async def set_state(
        self, channel_id: str, member_id: str, *, mic: bool, cam: bool
    ) -> Peer | None:
        """Update mic/cam; None if the member already left."""
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None
            if peer is not None:
                peer.mic_on = mic
                peer.cam_on = cam
        return peer

    async def send_to(self, channel_id: str, member_id: str, message: dict[str, object]) -> bool:
        """Deliver to one peer; True if delivered."""
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None

        if peer is None or peer.send is None:
            return False
        return await _safe_send(peer, message)

    async def broadcast(
        self, channel_id: str, message: dict[str, object], *, exclude: str | None = None
    ) -> None:
        """Deliver to all peers, optionally excluding one (no echo)."""
        async with self._lock:
            room = self._rooms.get(channel_id)
            targets = (
                [p for mid, p in room.peers.items() if mid != exclude] if room is not None else []
            )

        for peer in targets:
            await _safe_send(peer, message)

    def snapshot(self, channel_id: str) -> list[dict[str, object]]:
        """Peers in the room, for the REST lookup."""
        room = self._rooms.get(channel_id)
        if room is None:
            return []
        return [peer.public() for peer in room.peers.values()]

    def count(self, channel_id: str) -> int:
        room = self._rooms.get(channel_id)
        return len(room.peers) if room is not None else 0

    async def reset(self) -> None:
        """Clear all rooms (tests only)."""
        async with self._lock:
            self._rooms.clear()


async def _safe_send(peer: Peer, message: dict[str, object]) -> bool:
    """Send to a peer; False on dead connection (cleanup belongs to the endpoint)."""
    if peer.send is None:
        return False
    try:
        await peer.send(message)
    except Exception:
        logger.debug("no se pudo enviar a %s; conexión probablemente cerrada", peer.member_id)
        return False
    return True


def parse_signal(raw: str) -> dict[str, object] | None:
    """Parse raw socket text; None for invalid JSON or non-dict payloads."""
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def message_kind(message: dict[str, object]) -> str | None:
    """Message `type` if present and str, else None."""
    kind = message.get("type")
    return kind if isinstance(kind, str) else None


def is_forwardable(kind: str) -> bool:
    """Whether the kind is relayed verbatim between peers."""
    return kind in _FORWARDED


#: Process-wide manager, created at import.
call_manager = CallManager()
