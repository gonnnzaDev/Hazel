from __future__ import annotations

import json
import logging

from calls.model import Peer
from calls.repository import RoomStore

logger = logging.getLogger(__name__)

_FORWARDED = frozenset({"offer", "answer", "ice"})


class CallManager:
    def __init__(self, store: RoomStore | None = None) -> None:
        self._store = store or RoomStore()

    async def join(self, channel_id: str, peer: Peer) -> list[Peer]:
        existing = await self._store.add(channel_id, peer)
        logger.info("call %s: join %s (%d present)", channel_id, peer.nickname, len(existing) + 1)
        return existing

    async def leave(self, channel_id: str, member_id: str) -> list[Peer]:
        remaining = await self._store.remove(channel_id, member_id)
        logger.info("call %s: leave %s (%d remaining)", channel_id, member_id, len(remaining))
        return remaining

    async def set_state(
        self, channel_id: str, member_id: str, *, mic: bool, cam: bool
    ) -> Peer | None:
        return await self._store.update_state(channel_id, member_id, mic=mic, cam=cam)

    async def send_to(self, channel_id: str, member_id: str, message: dict[str, object]) -> bool:
        peer = self._store.get(channel_id, member_id)
        if peer is None or peer.send is None:
            return False
        return await _safe_send(peer, message)

    async def broadcast(
        self, channel_id: str, message: dict[str, object], *, exclude: str | None = None
    ) -> None:
        for peer in self._store.targets(channel_id, exclude):
            await _safe_send(peer, message)

    async def handle_signal(self, channel_id: str, peer: Peer, raw: str) -> None:
        message = parse_signal(raw)
        if message is None:
            return

        kind = message_kind(message)
        if kind is None:
            return

        if is_forwardable(kind):
            target = message.get("to")
            if not isinstance(target, str) or not target:
                return
            await self.send_to(
                channel_id,
                target,
                {
                    "type": kind,
                    "from": peer.member_id,
                    "payload": message.get("sdp") if kind != "ice" else message.get("candidate"),
                },
            )
            return

        if kind == "state":
            mic = _as_bool(message.get("mic"), default=peer.mic_on)
            cam = _as_bool(message.get("cam"), default=peer.cam_on)
            updated = await self.set_state(channel_id, peer.member_id, mic=mic, cam=cam)
            if updated is not None:
                await self.broadcast(
                    channel_id,
                    {
                        "type": "peer-state",
                        "member_id": peer.member_id,
                        "mic": updated.mic_on,
                        "cam": updated.cam_on,
                    },
                    exclude=peer.member_id,
                )

    def snapshot(self, channel_id: str) -> list[dict[str, object]]:
        return self._store.snapshot(channel_id)

    def count(self, channel_id: str) -> int:
        return self._store.count(channel_id)

    async def reset(self) -> None:
        await self._store.reset()


def _as_bool(value: object, *, default: bool) -> bool:
    return value if isinstance(value, bool) else default


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
    except ValueError, TypeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def message_kind(message: dict[str, object]) -> str | None:
    kind = message.get("type")
    return kind if isinstance(kind, str) else None


def is_forwardable(kind: str) -> bool:
    return kind in _FORWARDED


call_manager = CallManager()
