"""Lógica de identidad.

**No importa FastAPI.** Habla en excepciones de dominio, igual que
`apps/servers/services.py`.

Las reglas que implementa:

1. **El primero que entra es el dueño.** Un servidor sin dueño no se puede
   administrar, y el dueño es quien despliega el servidor en su máquina.
2. **El nickname es único dentro del servidor, y solo dentro.** El mismo
   nickname en otro servidor es otra persona.
3. **El token vale para un solo servidor.** Es lo que hace que la identidad no
   sea global.
4. **Un servidor no puede quedar sin dueño.** Si el dueño se va, el rol pasa al
   miembro más antiguo que quede. Un servidor sin dueño es un servidor que
   nadie puede borrar ni administrar.
5. **Nadie se puede echar a sí mismo ni a alguien de rol igual o superior.**
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

#: Cuánto vive un token si no se dice otra cosa.
DEFAULT_TOKEN_TTL = timedelta(days=30)

#: Bytes de entropía del token. 32 bytes = 256 bits: suficiente para que no se
#: pueda adivinar, y el token queda corto en la base de datos.
TOKEN_BYTES = 32


# ──────────────────────────────────────────────────────────────────────────────
# Tokens
# ──────────────────────────────────────────────────────────────────────────────


def generate_token() -> tuple[str, str]:
    """Devuelve `(token, hash)`. El token se muestra una vez; el hash se guarda."""
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    """SHA-256 en hexadecimal.

    No se usa bcrypt ni argon2 a propósito: el token tiene 256 bits de entropía
    generados al azar, no es una contraseña elegida por una persona. Un hash lento
    no agrega nada contra un atacante que ya tiene la base, porque no hay nada
    que adivinar.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


# ──────────────────────────────────────────────────────────────────────────────
# Lecturas
# ──────────────────────────────────────────────────────────────────────────────


async def get_member(session: AsyncSession, server_id: RecordId, member_id: RecordId) -> Member:
    """Carga un miembro por id, verificando que pertenezca al servidor."""
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
    """Busca un miembro por su nickname, dentro de un servidor."""
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
    """Miembros del servidor, ordenados por nickname (que es la identidad)."""
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
    """Cuántos miembros tiene el servidor."""
    return int(
        await session.scalar(
            select(func.count()).select_from(Member).where(Member.server_id == server_id)
        )
        or 0
    )


# ──────────────────────────────────────────────────────────────────────────────
# Entrar y salir
# ──────────────────────────────────────────────────────────────────────────────


async def join_server(
    session: AsyncSession, server: Server, payload: JoinRequest
) -> tuple[Member, str, datetime | None]:
    """Entra al servidor con un nickname. Devuelve `(miembro, token, vencimiento)`.

    Si el nickname ya está tomado en **este** servidor, la persona puede volver a
    entrar con el mismo nickname: así es como "perdés la contraseña" se resuelve
    sin cuenta global, simplemente entrando otra vez con el mismo nombre.
    """
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
        # Carrera: dos personas entraron con el mismo nickname a la vez. La base
        # lo bloquea con la unique constraint, que es donde tiene que resolverse.
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
    """Devuelve el miembro existente con ese nickname, o lo crea."""
    existing = await get_member_by_nickname_optional(session, server.id, canonical)
    if existing is not None:
        return existing

    is_first = await member_count(session, server.id) == 0

    member = Member(
        id=new_id(),
        server_id=server.id,
        nickname=canonical,
        display_name=display_name,
        # El primero que entra es el dueño. Sin dueño, el servidor no se puede
        # administrar ni borrar, y siempre hay uno.
        role=Role.OWNER if is_first else Role.MEMBER,
    )
    session.add(member)
    await session.flush()
    return member


async def get_member_by_nickname_optional(
    session: AsyncSession, server_id: RecordId, nickname: str
) -> Member | None:
    """Como `get_member_by_nickname`, pero `None` en vez de excepción."""
    canonical = nick.normalize(nickname)
    stmt = select(Member).where(Member.server_id == server_id, Member.nickname == canonical)
    return (await session.execute(stmt)).scalar_one_or_none()


def _default_display_name(canonical: str) -> str:
    """`"ana"` → `"Ana"`. Lo que quiere la mayoría de la gente."""
    return canonical.capitalize()


async def leave_server(session: AsyncSession, member: Member) -> None:
    """Sale del servidor.

    Si era el dueño, el rol pasa al miembro más antiguo que quede. Un servidor
    sin dueño sería un servidor que nadie puede administrar ni borrar.
    """
    server_id = member.server_id
    was_owner = member.role_enum is Role.OWNER

    await session.delete(member)
    await session.flush()

    if was_owner:
        await _promote_new_owner(session, server_id)


async def _promote_new_owner(session: AsyncSession, server_id: RecordId) -> None:
    """Pasa el rol de dueño al miembro más antiguo que quede."""
    successor = (
        await session.execute(
            select(Member)
            .where(Member.server_id == server_id)
            .order_by(Member.created_at, Member.nickname)
            .limit(1)
        )
    ).scalar_one_or_none()

    if successor is None:
        return  # El servidor quedó sin miembros. No hay a quién darle el rol.

    successor.role = Role.OWNER
    await session.flush()


async def kick_member(session: AsyncSession, actor: Member, target: Member) -> None:
    """Echa a un miembro del servidor.

    Tres reglas, en este orden:

    1. Hay que ser administrador. Un `member` no saca a nadie, ni siquiera a otro
       `member`: sin esto, cualquiera que entre podría vaciar el servidor.
    2. No te podés expulsar a vos mismo. Para eso está "salir del servidor".
    3. No podés expulsar a alguien con un rol igual o superior: un `admin` no
       saca a otro `admin`, ni a sí mismo.
    """
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
    """Cambia el rol de un miembro.

    Nadie puede tocar el rol de dueño ni volverse dueño: el dueño se define al
    crear el servidor y se transmite por antigüedad cuando se va, no por un
    endpoint.
    """
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
# Autenticación
# ──────────────────────────────────────────────────────────────────────────────


async def authenticate(session: AsyncSession, raw_token: str) -> Member:
    """Resuelve un token a su miembro, o falla.

    Es la operación más caliente de la API: se ejecuta en cada request
    autenticado.
    """
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
    """Revoca el token con el que se está llamaando.

    Es el "salir" de un dispositivo concreto. Borra la fila: si el token estaba
    en el log de alguna petición, deja de servir.
    """
    token_hash = hash_token(raw_token)
    await session.execute(delete(MemberToken).where(MemberToken.token_hash == token_hash))
    await session.flush()


async def revoke_all_tokens(session: AsyncSession, member: Member) -> int:
    """Revoca todos los tokens de un miembro. Devuelve cuántos eran."""
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
    """Todos los servidores donde el token actual es válido.

    Solo devuelve los que comparten el token **exacto**, no los del nickname:
    cada servidor tiene su propio token, que es lo que hace que la identidad no
    sea global.
    """
    token_hash = hash_token(raw_token)
    stmt = (
        select(Member, Server)
        .join(MemberToken, MemberToken.member_id == Member.id)
        .join(Server, Server.id == Member.server_id)
        .where(MemberToken.token_hash == token_hash, MemberToken.revoked_at.is_(None))
    )
    rows = (await session.execute(stmt)).all()
    return [(member, server) for member, server in rows]
