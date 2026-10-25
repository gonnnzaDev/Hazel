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
from events.outbox import queue_event
from identity import repository
from identity.model import Member
from identity.roles import Role
from identity.schemas import JoinRequest
from servers.model import Server
from servers.service import ensure_active

DEFAULT_TOKEN_TTL = timedelta(days=30)

TOKEN_BYTES = 32


def generate_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, repository.hash_token(raw)


async def join_server(
    session: AsyncSession, server: Server, payload: JoinRequest
) -> tuple[Member, str, datetime | None]:
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
        await session.rollback()
        raise ConflictError(
            f"Nickname '{canonical}' was just taken. Try another one.",
            code="nickname_taken",
            extra={"nickname": canonical},
        ) from None

    await session.refresh(member)
    await queue_event(
        session,
        "member.joined",
        server_id=server.id,
        data={
            "member_id": str(member.id),
            "nickname": member.nickname,
            "display_name": member.display_name,
            "role": member.role_enum.label,
        },
    )
    return member, raw_token, token.expires_at


async def _find_or_create_member(
    session: AsyncSession, server: Server, canonical: str, display_name: str
) -> Member:
    existing = await repository.get_member_by_nickname_optional(session, server.id, canonical)
    if existing is not None:
        return existing

    is_first = await repository.member_count(session, server.id) == 0

    return await repository.create_member(
        session,
        server_id=server.id,
        nickname=canonical,
        display_name=display_name,
        role=Role.OWNER if is_first else Role.MEMBER,
    )


def _default_display_name(canonical: str) -> str:
    return canonical.capitalize()


async def leave_server(session: AsyncSession, member: Member) -> None:
    server_id = member.server_id
    was_owner = member.role_enum is Role.OWNER
    member_id = member.id
    nickname = member.nickname
    display_name = member.display_name

    await repository.delete_member(session, member)

    if was_owner:
        await repository.promote_oldest_to_owner(session, server_id)

    await queue_event(
        session,
        "member.left",
        server_id=server_id,
        data={
            "member_id": str(member_id),
            "nickname": nickname,
            "display_name": display_name,
            "reason": "left",
        },
    )


async def kick_member(session: AsyncSession, actor: Member, target: Member) -> None:
    if not actor.role_enum.can_administer:
        raise PermissionDeniedError(
            "You must be an administrator to kick someone.",
            code="not_admin",
        )

    if actor.id == target.id:
        raise ValidationDomainError(
            "You cannot kick yourself. Use 'leave the server'.",
            code="cannot_kick_self",
        )

    if actor.role <= target.role:
        raise PermissionDeniedError(
            "You cannot kick someone with an equal or higher role than yours.",
            code="role_hierarchy",
            extra={"your_role": actor.role_enum.label, "their_role": target.role_enum.label},
        )

    server_id = target.server_id
    was_owner = target.role_enum is Role.OWNER
    member_id = target.id
    nickname = target.nickname
    display_name = target.display_name

    await repository.delete_member(session, target)

    if was_owner:
        await repository.promote_oldest_to_owner(session, server_id)

    await queue_event(
        session,
        "member.left",
        server_id=server_id,
        data={
            "member_id": str(member_id),
            "nickname": nickname,
            "display_name": display_name,
            "reason": "kicked",
            "by": actor.nickname,
        },
    )


async def set_role(session: AsyncSession, actor: Member, target: Member, role: Role) -> Member:
    if actor.role < Role.ADMIN:
        raise PermissionDeniedError(
            "You must be an administrator to change roles.",
            code="not_admin",
        )

    if target.role_enum is Role.OWNER or role is Role.OWNER:
        raise PermissionDeniedError(
            "The owner role cannot be changed via API.",
            code="owner_role_immutable",
        )

    return await repository.set_member_role(session, target, role)


async def authenticate(session: AsyncSession, raw_token: str) -> Member:
    if not raw_token:
        raise AuthenticationError(
            "Missing token.",
            code="missing_token",
        )

    token = await repository.get_token_with_member(session, repository.hash_token(raw_token))

    if token is None or not token.is_usable:
        raise AuthenticationError(
            "The token is invalid or expired.",
            code="invalid_token",
        )

    member = token.member
    if member.is_online is False:
        member.last_seen_at = utcnow()
    await session.flush()
    return member
