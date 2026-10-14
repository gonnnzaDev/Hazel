"""Identity orchestration; FastAPI-free, raises domain errors.

Invariants: first joiner is owner, nicknames/tokens are per-server, server keeps an
owner, no self/equal-or-higher kicks. Persistence lives in `identity.repository`.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from common import nickname as nick
from common.types import utcnow
from core.api.errors import (
    AuthenticationError,
    ConflictError,
    PermissionDeniedError,
    ValidationDomainError,
)
from identity import repository
from identity.model import Member
from identity.roles import Role
from identity.schemas import JoinRequest
from servers.model import Server
from servers.service import ensure_active

#: Default token lifetime.
DEFAULT_TOKEN_TTL = timedelta(days=30)

#: Token entropy bytes (32 bytes = 256 bits).
TOKEN_BYTES = 32


def generate_token() -> tuple[str, str]:
    """Return (token, hash); raw token is shown once."""
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, repository.hash_token(raw)


async def join_server(
    session: AsyncSession, server: Server, payload: JoinRequest
) -> tuple[Member, str, datetime | None]:
    """Join with a nickname; re-joining a taken nickname recovers access."""
    ensure_active(server)

    canonical = nick.validate(payload.nickname)
    display_name = payload.display_name or _default_display_name(canonical)

    member = await _find_or_create_member(session, server, canonical, display_name)

    raw_token, token_hash = generate_token()
    try:
        token = await repository.issue_token(
            session,
            member_id=member.id,
            server_id=server.id,
            token_hash=token_hash,
            expires_at=utcnow() + DEFAULT_TOKEN_TTL,
        )
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
    existing = await repository.get_member_by_nickname_optional(session, server.id, canonical)
    if existing is not None:
        return existing

    is_first = await repository.member_count(session, server.id) == 0

    # First joiner becomes owner so the server stays administrable.
    return await repository.create_member(
        session,
        server_id=server.id,
        nickname=canonical,
        display_name=display_name,
        role=Role.OWNER if is_first else Role.MEMBER,
    )


def _default_display_name(canonical: str) -> str:
    """Default display name: capitalized nickname."""
    return canonical.capitalize()


async def leave_server(session: AsyncSession, member: Member) -> None:
    """Leave the server; ownership passes to oldest remaining member."""
    server_id = member.server_id
    was_owner = member.role_enum is Role.OWNER

    await repository.delete_member(session, member)

    if was_owner:
        await repository.promote_oldest_to_owner(session, server_id)


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

    await repository.delete_member(session, target)

    if was_owner:
        await repository.promote_oldest_to_owner(session, server_id)


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

    return await repository.set_member_role(session, target, role)


async def authenticate(session: AsyncSession, raw_token: str) -> Member:
    """Resolve a token to its member. Runs on every authenticated request."""
    if not raw_token:
        raise AuthenticationError(
            "Falta el token.",
            code="missing_token",
        )

    token = await repository.get_token_with_member(session, repository.hash_token(raw_token))

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
