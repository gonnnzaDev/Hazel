from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from common import nickname as nick
from common.types import RecordId, new_id, utcnow
from core.api.errors import NotFoundError
from identity.model import Member, MemberToken
from identity.roles import Role
from servers.model import Server


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def get_member(session: AsyncSession, server_id: RecordId, member_id: RecordId) -> Member:
    stmt = select(Member).where(Member.id == member_id, Member.server_id == server_id)
    member = (await session.execute(stmt)).scalar_one_or_none()

    if member is None:
        raise NotFoundError(
            "That member does not exist on this server.",
            code="member_not_found",
            extra={"member_id": str(member_id)},
        )
    return member


async def get_member_by_nickname(
    session: AsyncSession, server_id: RecordId, nickname: str
) -> Member:
    canonical = nick.normalize(nickname)
    stmt = select(Member).where(Member.server_id == server_id, Member.nickname == canonical)
    member = (await session.execute(stmt)).scalar_one_or_none()

    if member is None:
        raise NotFoundError(
            f"No one with nickname '{canonical}' is on this server.",
            code="member_not_found_by_nickname",
            extra={"nickname": canonical},
        )
    return member


async def list_members(
    session: AsyncSession, server_id: RecordId, *, limit: int, offset: int
) -> tuple[list[Member], int]:
    total = await session.scalar(
        select(func.count()).select_from(Member).where(Member.server_id == server_id)
    )
    stmt = (
        select(Member)
        .where(Member.server_id == server_id)
        .order_by(Member.nickname)
        .limit(limit)
        .offset(offset)
    )
    members = (await session.execute(stmt)).scalars().all()
    return list(members), int(total or 0)


async def member_count(session: AsyncSession, server_id: RecordId) -> int:
    return int(
        await session.scalar(
            select(func.count()).select_from(Member).where(Member.server_id == server_id)
        )
        or 0
    )


async def get_member_by_nickname_optional(
    session: AsyncSession, server_id: RecordId, nickname: str
) -> Member | None:
    canonical = nick.normalize(nickname)
    stmt = select(Member).where(Member.server_id == server_id, Member.nickname == canonical)
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_token_with_member(session: AsyncSession, token_hash: str) -> MemberToken | None:
    stmt = (
        select(MemberToken)
        .options(selectinload(MemberToken.member))
        .where(MemberToken.token_hash == token_hash)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def create_member(
    session: AsyncSession,
    *,
    server_id: RecordId,
    nickname: str,
    display_name: str,
    role: Role,
) -> Member:
    member = Member(
        id=new_id(),
        server_id=server_id,
        nickname=nickname,
        display_name=display_name,
        role=role,
    )
    session.add(member)
    await session.flush()
    return member


async def issue_token(
    session: AsyncSession,
    *,
    member_id: RecordId,
    server_id: RecordId,
    token_hash: str,
    expires_at: datetime | None,
) -> MemberToken:
    token = MemberToken(
        id=new_id(),
        member_id=member_id,
        server_id=server_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    session.add(token)
    await session.flush()
    return token


async def delete_member(session: AsyncSession, member: Member) -> None:
    await session.delete(member)
    await session.flush()


async def set_member_role(session: AsyncSession, member: Member, role: Role) -> Member:
    member.role = role
    await session.flush()
    return member


async def promote_oldest_to_owner(session: AsyncSession, server_id: RecordId) -> None:
    successor = (
        await session.execute(
            select(Member)
            .where(Member.server_id == server_id)
            .order_by(Member.created_at, Member.nickname)
            .limit(1)
        )
    ).scalar_one_or_none()

    if successor is None:
        return

    successor.role = Role.OWNER
    await session.flush()


async def revoke_token(session: AsyncSession, raw_token: str) -> None:
    token_hash = hash_token(raw_token)
    await session.execute(delete(MemberToken).where(MemberToken.token_hash == token_hash))
    await session.flush()


async def revoke_all_tokens(session: AsyncSession, member: Member) -> int:
    result = await session.execute(
        update(MemberToken)
        .where(MemberToken.member_id == member.id, MemberToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
        .returning(MemberToken.id)
    )
    count = len(result.all())
    await session.flush()
    return count


async def list_my_sessions(session: AsyncSession, raw_token: str) -> list[tuple[Member, Server]]:
    token_hash = hash_token(raw_token)
    stmt = (
        select(Member, Server)
        .join(MemberToken, MemberToken.member_id == Member.id)
        .join(Server, Server.id == Member.server_id)
        .where(MemberToken.token_hash == token_hash, MemberToken.revoked_at.is_(None))
    )
    rows = (await session.execute(stmt)).all()
    return [(member, server) for member, server in rows]
