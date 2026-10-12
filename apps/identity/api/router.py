"""Endpoints de identidad.

Entrada, salida, miembros y sesiones. Todo lo que hace que una persona sea
alguien dentro de un servidor.
"""

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


# ─── Conversores ──────────────────────────────────────────────────────────────
#
# Los schemas no usan `from_attributes` a propósito: `joined_at` no existe en el
# modelo (está en `created_at`) y renombrar la columna o agregar una propiedad
# duplicada por un mapper no vale la pena. Cuatro funciones explícitas son más
# claras que un `model_validate` con tricks.


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


# ─── Entrar y salir ───────────────────────────────────────────────────────────


@router.post(
    "/servers/{server_id}/join",
    response_model=JoinResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Entrar a un servidor con un nickname",
)
async def join(session: SessionDep, server_id: ServerId, payload: JoinRequest) -> JoinResponse:
    """Entra al servidor. Solo hace falta un nombre.

    No hay email, ni password, ni cuenta. Si el nickname ya está tomado en este
    servidor, la persona **puede volver a entrar** con el mismo: así es como se
    recupera el acceso sin cuenta global.

    El primero que entra al servidor es su dueño.
    """
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
    """Sale del servidor y revoca todos sus tokens.

    Si eras el dueño, el rol pasa al miembro más antiguo que quede: un servidor
    sin dueño no se podría administrar ni borrar.
    """
    await services.revoke_all_tokens(session, member)
    await services.leave_server(session, member)


# ─── Sesiones ─────────────────────────────────────────────────────────────────


@router.post("/auth/refresh", response_model=TokenResponse, summary="Renovar el token")
async def refresh(raw: RawToken, session: SessionDep) -> TokenResponse:
    """Emite un token nuevo y revoca el actual.

    Se usa cuando el token está por vencer. El viejo deja de servir en el mismo
    instante, así que un token robado no sobrevive a la rotación.
    """
    member = await services.authenticate(session, raw)
    await services.revoke_token(session, raw)
    return await _issue_token(session, member)


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cerrar sesión en este dispositivo",
)
async def logout(raw: RawToken, session: SessionDep) -> None:
    """Revoca el token con el que llamaste. Los otros dispositivos siguen."""
    await services.authenticate(session, raw)  # valida antes de revocar
    await services.revoke_token(session, raw)


@router.post("/auth/logout-all", summary="Cerrar sesión en todos los dispositivos")
async def logout_all(raw: RawToken, session: SessionDep) -> dict[str, object]:
    """Revoca todos los tokens de este servidor y emite uno nuevo.

    Para cuando pensás que te robaron la sesión. El token devuelto es el único
    que sigue funcionando.
    """
    member = await services.authenticate(session, raw)
    revoked = await services.revoke_all_tokens(session, member)
    fresh = await _issue_token(session, member)
    return {"token": fresh.token, "expires_at": fresh.expires_at, "revoked_sessions": revoked}


async def _issue_token(session: SessionDep, member: Member) -> TokenResponse:
    """Emite un token nuevo para un miembro."""
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


# ─── Quién soy ────────────────────────────────────────────────────────────────


@router.get("/me", response_model=MeResponse, summary="Quién soy")
async def me(member: CurrentMember, session: SessionDep) -> MeResponse:
    """Tu identidad en el servidor donde estás.

    Cada servidor tiene su propio token. Si tenés sesión en tres servidores,
    tenés tres tokens distintos y tres identidades distintas — y para mirar las
    otras dos necesitás sus tokens, no este.
    """
    server = await server_services.get_server(session, member.server_id)
    return MeResponse(member=_member_read(member), server=_server_summary(server))


@router.patch("/me", response_model=MemberRead, summary="Cambiar mi nombre visible")
async def update_me(member: CurrentMember, session: SessionDep, payload: MeUpdate) -> MemberRead:
    """Cambia tu nombre visible en el servidor donde estás.

    El nickname **no** se puede cambiar: es tu identidad ahí, y los mensajes
    pasados apuntan a él.
    """
    member.display_name = payload.display_name
    await session.flush()
    return _member_read(member)


# ─── Miembros ─────────────────────────────────────────────────────────────────


@router.get(
    "/servers/{server_id}/members",
    response_model=MemberListResponse,
    summary="Listar miembros",
)
async def list_members(
    session: SessionDep, server_id: ServerId, limit: QueryLimit = 50, offset: QueryOffset = 0
) -> MemberListResponse:
    """Quiénes están en el servidor, ordenados por nickname."""
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
    """Un miembro por su nickname, dentro de este servidor.

    El mismo nickname puede existir en otro servidor. Ahí es otra persona.
    """
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
    """Echa a alguien del servidor.

    Solo un admin o el dueño. Y no podés echar a alguien con tu mismo rol o
    superior: un admin no saca a otro admin.
    """
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
    """Sube o baja el rol de alguien.

    El rol de dueño no se toca por API: se define al crear el servidor y se
    transmite por antigüedad cuando el dueño se va.

    El rol va por nombre (`?role=admin`), no por número. `Role` es un `IntEnum`
    porque en la base el orden importa, pero un cliente no debería tener que
    saber que admin es 50.
    """
    new_role = _parse_role(role)
    target = await services.get_member_by_nickname(session, server_id, nickname)
    return _member_read(await services.set_role(session, actor, target, new_role))


def _parse_role(label: str) -> Role:
    """Convierte el texto del query en un `Role`, con un error legible."""
    try:
        return Role.from_label(label)
    except ValueError:
        raise ValidationDomainError(
            f"Rol desconocido: '{label}'.",
            code="invalid_role",
            extra={"allowed": [Role.MEMBER.label, Role.ADMIN.label]},
        ) from None
