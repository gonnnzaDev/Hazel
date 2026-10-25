from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select

from channels.model import Channel
from common.types import utcnow
from config.bdd_config.bdd_config import session_scope
from identity import service as identity_service
from identity.model import Member
from servers import repository as servers_repository
from servers.service import ensure_active


@dataclass(frozen=True, slots=True)
class ConnectionIdentity:
    member_id: str
    nickname: str
    display_name: str
    server_id: str
    server_slug: str
    server_name: str


async def authenticate_connection(token: str) -> ConnectionIdentity:
    async with session_scope() as session:
        member = await identity_service.authenticate(session, token)
        server = await servers_repository.get_server(session, member.server_id)
        ensure_active(server)

        return ConnectionIdentity(
            member_id=str(member.id),
            nickname=member.nickname,
            display_name=member.display_name,
            server_id=str(server.id),
            server_slug=server.slug,
            server_name=server.name,
        )


async def set_presence(member_id: str, *, online: bool) -> None:
    async with session_scope() as session:
        member = await session.get(Member, uuid.UUID(member_id))
        if member is None:
            return

        member.is_online = online
        member.last_seen_at = utcnow()
        await session.flush()


async def channel_exists(server_id: str, channel_id: str) -> bool:
    try:
        sid = uuid.UUID(server_id)
        cid = uuid.UUID(channel_id)
    except ValueError:
        return False

    async with session_scope() as session:
        found = await session.scalar(
            select(Channel.id).where(Channel.id == cid, Channel.server_id == sid)
        )
        return found is not None
