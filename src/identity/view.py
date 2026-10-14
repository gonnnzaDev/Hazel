from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from common.types import RecordId, new_id, utcnow
from core.api.errors import ValidationDomainError
from identity import repository, service
from identity.deps import CurrentMember, RawToken, SessionDep
from identity.model import Member, MemberToken
from identity.roles import Role
from identity.schemas import (
    JoinRequest,
    JoinResponse,
    MemberListResponse,
    MemberRead,
    MeResponse,
    MeUpdate,
    ServerSummary,
    TokenResponse,
)
from servers import repository as servers_repository

router = APIRouter()

ServerId = Annotated[RecordId, Path(description="Server identifier")]
MemberNick = Annotated[str, Path(min_length=2, max_length=32, description="Nickname")]
QueryLimit = Annotated[int, Query(ge=1, le=200)]
QueryOffset = Annotated[int, Query(ge=0)]


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


@router.post(
    "/servers/{server_id}/join",
    response_model=JoinResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Join a server with a nickname",
)
async def join(session: SessionDep, server_id: ServerId, payload: JoinRequest) -> JoinResponse:
    server = await servers_repository.get_server(session, server_id)
    member, token, expires_at = await service.join_server(session, server, payload)

    return JoinResponse(
        token=token,
        expires_at=expires_at,
        member=_member_read(member),
        server=_server_summary(server),
    )


@router.post(
    "/servers/{server_id}/leave",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Leave the server",
)
async def leave(member: CurrentMember, session: SessionDep) -> None:
    await service.revoke_all_tokens(session, member)
    await service.leave_server(session, member)


@router.post("/auth/refresh", response_model=TokenResponse, summary="Refresh the token")
async def refresh(raw: RawToken, session: SessionDep) -> TokenResponse:
    member = await service.authenticate(session, raw)
    await service.revoke_token(session, raw)
    return await _issue_token(session, member)


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Log out on this device",
)
async def logout(raw: RawToken, session: SessionDep) -> None:
    await service.authenticate(session, raw)
    await service.revoke_token(session, raw)


@router.post("/auth/logout-all", summary="Log out on all devices")
async def logout_all(raw: RawToken, session: SessionDep) -> dict[str, object]:
    member = await service.authenticate(session, raw)
    revoked = await service.revoke_all_tokens(session, member)
    fresh = await _issue_token(session, member)
    return {"token": fresh.token, "expires_at": fresh.expires_at, "revoked_sessions": revoked}


async def _issue_token(session: SessionDep, member: Member) -> TokenResponse:
    raw, token_hash = service.generate_token()
    token = MemberToken(
        id=new_id(),
        member_id=member.id,
        server_id=member.server_id,
        token_hash=token_hash,
        expires_at=utcnow() + service.DEFAULT_TOKEN_TTL,
    )
    session.add(token)
    await session.flush()
    return TokenResponse(token=raw, expires_at=token.expires_at)


@router.get("/me", response_model=MeResponse, summary="Who am I")
async def me(member: CurrentMember, session: SessionDep) -> MeResponse:
    server = await servers_repository.get_server(session, member.server_id)
    return MeResponse(member=_member_read(member), server=_server_summary(server))


@router.patch("/me", response_model=MemberRead, summary="Change my display name")
async def update_me(member: CurrentMember, session: SessionDep, payload: MeUpdate) -> MemberRead:
    member.display_name = payload.display_name
    await session.flush()
    return _member_read(member)


@router.get(
    "/servers/{server_id}/members",
    response_model=MemberListResponse,
    summary="List members",
)
async def list_members(
    session: SessionDep, server_id: ServerId, limit: QueryLimit = 50, offset: QueryOffset = 0
) -> MemberListResponse:
    await servers_repository.get_server(session, server_id)
    members, total = await repository.list_members(session, server_id, limit=limit, offset=offset)
    return MemberListResponse(
        items=[_member_read(m) for m in members], total=total, limit=limit, offset=offset
    )


@router.get(
    "/servers/{server_id}/members/{nickname}",
    response_model=MemberRead,
    summary="Get a member",
)
async def get_member(session: SessionDep, server_id: ServerId, nickname: MemberNick) -> MemberRead:
    await servers_repository.get_server(session, server_id)
    member = await repository.get_member_by_nickname(session, server_id, nickname)
    return _member_read(member)


@router.delete(
    "/servers/{server_id}/members/{nickname}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Kick a member",
)
async def kick_member(
    session: SessionDep, server_id: ServerId, nickname: MemberNick, actor: CurrentMember
) -> None:
    target = await repository.get_member_by_nickname(session, server_id, nickname)
    await service.kick_member(session, actor, target)


@router.put(
    "/servers/{server_id}/members/{nickname}/role",
    response_model=MemberRead,
    summary="Change a member's role",
)
async def set_member_role(
    session: SessionDep,
    server_id: ServerId,
    nickname: MemberNick,
    actor: CurrentMember,
    role: Annotated[str, Query(description="member or admin")],
) -> MemberRead:
    new_role = _parse_role(role)
    target = await repository.get_member_by_nickname(session, server_id, nickname)
    return _member_read(await service.set_role(session, actor, target, new_role))


def _parse_role(label: str) -> Role:
    try:
        return Role.from_label(label)
    except ValueError:
        raise ValidationDomainError(
            f"Unknown role: '{label}'.",
            code="invalid_role",
            extra={"allowed": [Role.MEMBER.label, Role.ADMIN.label]},
        ) from None
