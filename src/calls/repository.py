from __future__ import annotations

import asyncio

from calls.model import Peer, Room


class RoomStore:

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def add(self, channel_id: str, peer: Peer) -> list[Peer]:
        async with self._lock:
            room = self._rooms.setdefault(channel_id, Room(channel_id=channel_id))
            existing = [p for mid, p in room.peers.items() if mid != peer.member_id]
            room.peers[peer.member_id] = peer
        return existing

    async def remove(self, channel_id: str, member_id: str) -> list[Peer]:
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return []
            room.peers.pop(member_id, None)
            remaining = list(room.peers.values())
            if room.is_empty:
                del self._rooms[channel_id]
        return remaining

    async def update_state(
        self, channel_id: str, member_id: str, *, mic: bool, cam: bool
    ) -> Peer | None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None
            if peer is not None:
                peer.mic_on = mic
                peer.cam_on = cam
        return peer

    def get(self, channel_id: str, member_id: str) -> Peer | None:
        room = self._rooms.get(channel_id)
        return room.peers.get(member_id) if room is not None else None

    def targets(self, channel_id: str, exclude: str | None = None) -> list[Peer]:
        room = self._rooms.get(channel_id)
        if room is None:
            return []
        return [p for mid, p in room.peers.items() if mid != exclude]

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
