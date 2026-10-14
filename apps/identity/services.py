"""Identity logic; FastAPI-free, raises domain exceptions.

Invariants: first joiner is owner, nicknames/tokens are per-server, server keeps an
owner, no self/equal-or-higher kicks.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.common import nickname as nick
from apps.common.types import RecordId, new_id, utcnow
from apps.identity.models import Member, MemberToken
from apps.identity.roles import Role
from apps.identity.schemas import JoinRequest
from apps.servers.models import Server
from apps.servers.services import ensure_active
from core.api.errors import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationDomainError,
)

#: Default token lifetime.
DEFAULT_TOKEN_TTL = timedelta(days=30)

#: Token entropy bytes (32 bytes = 256 bits).
TOKEN_BYTES = 32


# ──────────────────────────────────────────────────────────────────────────────
# Tokens
# ──────────────────────────────────────────────────────────────────────────────


def generate_token() -> tuple[str, str]:
    """Return (token, hash); raw token is shown once."""
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    """Hex SHA-256; slow hashes add nothing for 256-bit random tokens."""
    return hashlib.sha256(raw.encode()).hexdigest()


# ──────────────────────────────────────────────────────────────────────────────
# Reads
# ──────────────────────────────────────────────────────────────────────────────


async def get_member(session: AsyncSession, server_id: RecordId, member_id: RecordId) -> Member:
    """Load a member by id, scoped to the server."""
    stmt = select(Member).where(Member.id == member_id, Member.server_id == server_id)
    member = (await session.execute(stmt)).scalar_one_or_none()

    if member is None:
        raise NotFoundError(
            "Ese miembro no existe en este servidor.",
            code="member_not_found",
            extra={"member_id": str(member_id)},
        )
    return member


async def get_member_by_nickname(
    session: AsyncSession, server_id: RecordId, nickname: str
) -> Member:
    """Find a member by nickname within a server."""
    canonical = nick.normalize(nickname)
    stmt = select(Member).where(Member.server_id == server_id, Member.nickname == canonical)
    member = (await session.execute(stmt)).scalar_one_or_none()

    if member is None:
        raise NotFoundError(
            f"Nadie con el nickname '{canonical}' está en este servidor.",
            code="member_not_found_by_nickname",
            extra={"nickname": canonical},
        )
    return member


async def list_members(
    session: AsyncSession, server_id: RecordId, *, limit: int, offset: int
) -> tuple[list[Member], int]:
    """Server members ordered by nickname."""
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
    """Count server members."""
    return int(
        await session.scalar(
            select(func.count()).select_from(Member).where(Member.server_id == server_id)
        )
        or 0
    )


# ──────────────────────────────────────────────────────────────────────────────
# Join/leave
# ──────────────────────────────────────────────────────────────────────────────


async def join_server(
    session: AsyncSession, server: Server, payload: JoinRequest
) -> tuple[Member, str, datetime | None]:
    """Join with a nickname; re-joining a taken nickname recovers access."""
    ensure_active(server)

    canonical = nick.validate(payload.nickname)
    display_name = payload.display_name or _default_display_name(canonical)

    member = await _find_or_create_member(session, server, canonical, display_name)

    raw_token, token_hash = generate_token()
    token = MemberToken(
        id=new_id(),
        member_id=member.id,
        server_id=server.id,
        token_hash=token_hash,
        expires_at=utcnow() + DEFAULT_TOKEN_TTL,
    )
    session.add(token)

    try:
        await session.flush()
    except IntegrityError:
        # Race: same nickname joined concurrently; unique constraint decides.
        await session.rollback()
        raise ConflictError(
            f"El nickname '{canonical}' acaba de ser tomado. Probá con otro.",
            code="nickname_taken",
            extra={"nickname": canonical},
        ) from None

    await session.refresh(member)
    return member, raw_token, token.expires_at


async def _find_or_create_member(
    session: AsyncSession, server: Server, canonical: str, display_name: str
) -> Member:
    """Return existing member or create it."""
    existing = await get_member_by_nickname_optional(session, server.id, canonical)
    if existing is not None:
        return existing

    is_first = await member_count(session, server.id) == 0

    member = Member(
        id=new_id(),
        server_id=server.id,
        nickname=canonical,
        display_name=display_name,
        # First joiner becomes owner so the server stays administrable.
        role=Role.OWNER if is_first else Role.MEMBER,
    )
    session.add(member)
    await session.flush()
    return member


async def get_member_by_nickname_optional(
    session: AsyncSession, server_id: RecordId, nickname: str
) -> Member | None:
    """Like get_member_by_nickname but returns None."""
    canonical = nick.normalize(nickname)
    stmt = select(Member).where(Member.server_id == server_id, Member.nickname == canonical)
    return (await session.execute(stmt)).scalar_one_or_none()


def _default_display_name(canonical: str) -> str:
    """Default display name: capitalized nickname."""
    return canonical.capitalize()


async def leave_server(session: AsyncSession, member: Member) -> None:
    """Leave the server; ownership passes to oldest remaining member."""
    server_id = member.server_id
    was_owner = member.role_enum is Role.OWNER

    await session.delete(member)
    await session.flush()

    if was_owner:
        await _promote_new_owner(session, server_id)


async def _promote_new_owner(session: AsyncSession, server_id: RecordId) -> None:
    """Promote oldest remaining member to owner."""
    successor = (
        await session.execute(
            select(Member)
            .where(Member.server_id == server_id)
            .order_by(Member.created_at, Member.nickname)
            .limit(1)
        )
    ).scalar_one_or_none()

    if successor is None:
        return  # Empty server; no successor.

    successor.role = Role.OWNER
    await session.flush()


async def kick_member(session: AsyncSession, actor: Member, target: Member) -> None:
    """Kick a member. Requires admin, no self-kick, and strictly higher role."""
    if not actor.role_enum.can_administer:
        raise PermissionDeniedError(
            "Necesitás ser administrador para expulsar a alguien.",
            code="not_admin",
        )

    if actor.id == target.id:
        raise ValidationDomainError(
            "No podés expulsarte a vos mismo. Usá 'salir del servidor'.",
            code="cannot_kick_self",
        )

    if actor.role <= target.role:
        raise PermissionDeniedError(
            "No podés expulsar a alguien con un rol igual o superior al tuyo.",
            code="role_hierarchy",
            extra={"your_role": actor.role_enum.label, "their_role": target.role_enum.label},
        )

    server_id = target.server_id
    was_owner = target.role_enum is Role.OWNER

    await session.delete(target)
    await session.flush()

    if was_owner:
        await _promote_new_owner(session, server_id)


async def set_role(session: AsyncSession, actor: Member, target: Member, role: Role) -> Member:
    """Change a member's role; owner role is immutable via API."""
    if actor.role < Role.ADMIN:
        raise PermissionDeniedError(
            "Necesitás ser administrador para cambiar roles.",
            code="not_admin",
        )

    if target.role_enum is Role.OWNER or role is Role.OWNER:
        raise PermissionDeniedError(
            "El rol de dueño no se puede cambiar por API.",
            code="owner_role_immutable",
        )

    target.role = role
    await session.flush()
    return target


# ──────────────────────────────────────────────────────────────────────────────
# Authentication
# ──────────────────────────────────────────────────────────────────────────────


async def authenticate(session: AsyncSession, raw_token: str) -> Member:
    """Resolve a token to its member. Runs on every authenticated request."""
    if not raw_token:
        raise AuthenticationError(
            "Falta el token.",
            code="missing_token",
        )

    token_hash = hash_token(raw_token)
    stmt = (
        select(MemberToken)
        .options(selectinload(MemberToken.member))
        .where(MemberToken.token_hash == token_hash)
    )
    token = (await session.execute(stmt)).scalar_one_or_none()

    if token is None or not token.is_usable:
        raise AuthenticationError(
            "El token no es válido o venció.",
            code="invalid_token",
        )

    member = token.member
    if member.is_online is False:
        member.last_seen_at = utcnow()
    await session.flush()
    return member


async def revoke_token(session: AsyncSession, raw_token: str) -> None:
    """Revoke the calling token (single device logout)."""
    token_hash = hash_token(raw_token)
    await session.execute(delete(MemberToken).where(MemberToken.token_hash == token_hash))
    await session.flush()


async def revoke_all_tokens(session: AsyncSession, member: Member) -> int:
    """Revoke all member tokens; return count."""
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
    """Servers where the exact token is valid; tokens are per-server."""
    token_hash = hash_token(raw_token)
    stmt = (
        select(Member, Server)
        .join(MemberToken, MemberToken.member_id == Member.id)
        .join(Server, Server.id == Member.server_id)
        .where(MemberToken.token_hash == token_hash, MemberToken.revoked_at.is_(None))
    )
    rows = (await session.execute(stmt)).all()
    return [(member, server) for member, server in rows]
