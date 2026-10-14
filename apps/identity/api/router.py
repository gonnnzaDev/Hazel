"""Identity endpoints: join, leave, members, and sessions."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from apps.common.types import RecordId, new_id, utcnow
from apps.identity import services
from apps.identity.deps import CurrentMember, RawToken, SessionDep
from apps.identity.models import Member, MemberToken
from apps.identity.roles import Role
from apps.identity.schemas import (
    JoinRequest,
    JoinResponse,
    MemberListResponse,
    MemberRead,
    MeResponse,
    MeUpdate,
    ServerSummary,
    TokenResponse,
)
from apps.servers import services as server_services
from core.api.errors import ValidationDomainError

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Identificador del servidor")]
MemberNick = Annotated[str, Path(min_length=2, max_length=32, description="Nickname")]
QueryLimit = Annotated[int, Query(ge=1, le=200)]
QueryOffset = Annotated[int, Query(ge=0)]


# ─── Mappers ──────────────────────────────────────────────────────────────
#
# Explicit mappers: joined_at maps from created_at, so from_attributes is skipped.


def _member_read(member: Member) -> MemberRead:
    return MemberRead(
        id=str(member.id),
        nickname=member.nickname,
        display_name=member.display_name,
        role=Role(member.role),
        is_online=member.is_online,
        last_seen_at=member.last_seen_at,
        joined_at=member.created_at,
    )


def _server_summary(server: object) -> ServerSummary:
    return ServerSummary(id=str(server.id), slug=server.slug, name=server.name)  # type: ignore[attr-defined]


# ─── Join/leave ───────────────────────────────────────────────────────────


@router.post(
    "/servers/{server_id}/join",
    response_model=JoinResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Entrar a un servidor con un nickname",
)
async def join(session: SessionDep, server_id: ServerId, payload: JoinRequest) -> JoinResponse:
    """Join the server; re-joining a taken nickname recovers access. First joiner is owner."""
    server = await server_services.get_server(session, server_id)
    member, token, expires_at = await services.join_server(session, server, payload)

    return JoinResponse(
        token=token,
        expires_at=expires_at,
        member=_member_read(member),
        server=_server_summary(server),
    )


@router.post(
    "/servers/{server_id}/leave",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Salir del servidor",
)
async def leave(member: CurrentMember, session: SessionDep) -> None:
    """Leave the server and revoke all tokens; ownership passes to oldest member left."""
    await services.revoke_all_tokens(session, member)
    await services.leave_server(session, member)


# ─── Sessions ─────────────────────────────────────────────────────────────────


@router.post("/auth/refresh", response_model=TokenResponse, summary="Renovar el token")
async def refresh(raw: RawToken, session: SessionDep) -> TokenResponse:
    """Issue a new token and revoke the current one."""
    member = await services.authenticate(session, raw)
    await services.revoke_token(session, raw)
    return await _issue_token(session, member)


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cerrar sesión en este dispositivo",
)
async def logout(raw: RawToken, session: SessionDep) -> None:
    """Revoke the calling token; other devices stay logged in."""
    await services.authenticate(session, raw)  # validate before revoking
    await services.revoke_token(session, raw)


@router.post("/auth/logout-all", summary="Cerrar sesión en todos los dispositivos")
async def logout_all(raw: RawToken, session: SessionDep) -> dict[str, object]:
    """Revoke all tokens and issue a fresh one; returns revoked count."""
    member = await services.authenticate(session, raw)
    revoked = await services.revoke_all_tokens(session, member)
    fresh = await _issue_token(session, member)
    return {"token": fresh.token, "expires_at": fresh.expires_at, "revoked_sessions": revoked}


async def _issue_token(session: SessionDep, member: Member) -> TokenResponse:
    """Issue a new token for a member."""
    raw, token_hash = services.generate_token()
    token = MemberToken(
        id=new_id(),
        member_id=member.id,
        server_id=member.server_id,
        token_hash=token_hash,
        expires_at=utcnow() + services.DEFAULT_TOKEN_TTL,
    )
    session.add(token)
    await session.flush()
    return TokenResponse(token=raw, expires_at=token.expires_at)


# ─── Self ────────────────────────────────────────────────────────────────


@router.get("/me", response_model=MeResponse, summary="Quién soy")
async def me(member: CurrentMember, session: SessionDep) -> MeResponse:
    """Caller identity within this token's server; tokens are per-server."""
    server = await server_services.get_server(session, member.server_id)
    return MeResponse(member=_member_read(member), server=_server_summary(server))


@router.patch("/me", response_model=MemberRead, summary="Cambiar mi nombre visible")
async def update_me(member: CurrentMember, session: SessionDep, payload: MeUpdate) -> MemberRead:
    """Change caller display name; nickname is immutable."""
    member.display_name = payload.display_name
    await session.flush()
    return _member_read(member)


# ─── Members ─────────────────────────────────────────────────────────────────


@router.get(
    "/servers/{server_id}/members",
    response_model=MemberListResponse,
    summary="Listar miembros",
)
async def list_members(
    session: SessionDep, server_id: ServerId, limit: QueryLimit = 50, offset: QueryOffset = 0
) -> MemberListResponse:
    """List server members ordered by nickname."""
    await server_services.get_server(session, server_id)
    members, total = await services.list_members(session, server_id, limit=limit, offset=offset)
    return MemberListResponse(
        items=[_member_read(m) for m in members], total=total, limit=limit, offset=offset
    )


@router.get(
    "/servers/{server_id}/members/{nickname}",
    response_model=MemberRead,
    summary="Ver un miembro",
)
async def get_member(session: SessionDep, server_id: ServerId, nickname: MemberNick) -> MemberRead:
    """Get a member by nickname; nicknames are per-server."""
    await server_services.get_server(session, server_id)
    member = await services.get_member_by_nickname(session, server_id, nickname)
    return _member_read(member)


@router.delete(
    "/servers/{server_id}/members/{nickname}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Expulsar a un miembro",
)
async def kick_member(
    session: SessionDep, server_id: ServerId, nickname: MemberNick, actor: CurrentMember
) -> None:
    """Kick a member; requires admin and strictly higher role."""
    target = await services.get_member_by_nickname(session, server_id, nickname)
    await services.kick_member(session, actor, target)


@router.put(
    "/servers/{server_id}/members/{nickname}/role",
    response_model=MemberRead,
    summary="Cambiar el rol de un miembro",
)
async def set_member_role(
    session: SessionDep,
    server_id: ServerId,
    nickname: MemberNick,
    actor: CurrentMember,
    role: Annotated[str, Query(description="member o admin")],
) -> MemberRead:
    """Change a member's role via ?role=member|admin; owner role is immutable."""
    new_role = _parse_role(role)
    target = await services.get_member_by_nickname(session, server_id, nickname)
    return _member_read(await services.set_role(session, actor, target, new_role))


def _parse_role(label: str) -> Role:
    """Parse API role label into Role, raising a readable error."""
    try:
        return Role.from_label(label)
    except ValueError:
        raise ValidationDomainError(
            f"Rol desconocido: '{label}'.",
            code="invalid_role",
            extra={"allowed": [Role.MEMBER.label, Role.ADMIN.label]},
        ) from None
