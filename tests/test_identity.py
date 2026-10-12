"""Tests de identidad.

Estos tests fijan las reglas que sostienen el producto: no hay cuentas globales,
el primer que entra es el dueño, y un servidor nunca queda sin dueño.

Corre contra PostgreSQL real.
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from apps.identity import services
from apps.identity.roles import Role
from apps.identity.schemas import JoinRequest
from apps.servers import services as server_services
from apps.servers.schemas import ServerCreate
from core.api.errors import (
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    ServerInactiveError,
    ValidationDomainError,
)

TEST_DATABASE_URL = os.getenv("RECOP_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="definí RECOP_TEST_DATABASE_URL para correr los tests de integración",
)


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=None)
    connection = await engine.connect()
    transaction = await connection.begin()
    maker = async_sessionmaker(bind=connection, expire_on_commit=False)

    async with maker() as s:
        yield s

    await transaction.rollback()
    await connection.close()
    await engine.dispose()


@pytest_asyncio.fixture
async def server(session: AsyncSession):  # type: ignore[no-untyped-def]
    """Un servidor activo, listo para que entren miembros."""
    payload = ServerCreate(
        name="Casa de Luis", slug="casa-de-luis", owner_nickname="luis", max_members=50
    )
    return await server_services.create_server(session, payload)


async def join(session: AsyncSession, server, nickname: str):  # type: ignore[no-untyped-def]
    """Atajo: entra con un nickname y devuelve el miembro."""
    member, _token, _ = await services.join_server(session, server, JoinRequest(nickname=nickname))
    return member


# ──────────────────────────────────────────────────────────────────────────────
# Roles
# ──────────────────────────────────────────────────────────────────────────────


class TestRoles:
    def test_order_matters(self) -> None:
        """El rol se compara por valor, y el orden tiene que ser correcto."""
        assert Role.OWNER > Role.ADMIN > Role.MEMBER

    def test_permissions(self) -> None:
        assert Role.OWNER.can_administer and Role.ADMIN.can_administer
        assert not Role.MEMBER.can_administer
        assert Role.OWNER.can_delete_server
        assert not Role.ADMIN.can_delete_server

    def test_from_label(self) -> None:
        assert Role.from_label("admin") is Role.ADMIN
        assert Role.from_label("OWNER") is Role.OWNER

    def test_from_label_rejects_unknown(self) -> None:
        with pytest.raises(ValueError):
            Role.from_label("superusuario")


# ──────────────────────────────────────────────────────────────────────────────
# Tokens
# ──────────────────────────────────────────────────────────────────────────────


class TestTokens:
    def test_token_is_long_enough(self) -> None:
        """32 bytes de entropía: no se puede adivinar."""
        _, token_hash = services.generate_token()

        assert services.TOKEN_BYTES == 32
        assert len(token_hash) == 64  # sha256 en hex

    def test_hash_is_deterministic(self) -> None:
        """El mismo token siempre da el mismo hash: es lo que permite buscarlo."""
        assert services.hash_token("abc") == services.hash_token("abc")
        assert services.hash_token("abc") != services.hash_token("abd")

    def test_hash_is_not_the_token(self) -> None:
        raw, token_hash = services.generate_token()
        assert token_hash != raw
        assert len(raw) > 20


# ──────────────────────────────────────────────────────────────────────────────
# Entrar
# ──────────────────────────────────────────────────────────────────────────────


class TestJoin:
    async def test_first_member_is_the_owner(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """El primero que entra es el dueño.

        Si no lo fuera, el servidor quedaría sin nadie que lo administre ni lo
        borre.
        """
        member = await join(session, server, "luis")

        assert member.role_enum is Role.OWNER

    async def test_second_member_is_a_plain_member(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        await join(session, server, "luis")
        second = await join(session, server, "ana")

        assert second.role_enum is Role.MEMBER

    async def test_nickname_is_normalized(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """`"  Ana "` entra como `ana`."""
        member = await join(session, server, "  Ana  ")

        assert member.nickname == "ana"

    async def test_display_name_defaults_to_capitalized_nickname(
        self, session: AsyncSession, server
    ) -> None:  # type: ignore[no-untyped-def]
        member = await join(session, server, "ana")

        assert member.display_name == "Ana"

    async def test_display_name_can_be_custom(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        payload = JoinRequest(nickname="ana", display_name="Ana María")
        member, _, _ = await services.join_server(session, server, payload)

        assert member.display_name == "Ana María"

    async def test_rejoining_with_same_nickname_works(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Volver a entrar con el mismo nombre recupera el acceso.

        Así se resuelve "perdí la contraseña" sin cuenta global: entrás otra vez
        con el mismo nombre. Es el trade-off explícito de no tener cuentas.
        """
        first, token_a, _ = await services.join_server(session, server, JoinRequest(nickname="ana"))
        second, token_b, _ = await services.join_server(
            session, server, JoinRequest(nickname="ana")
        )

        assert first.id == second.id, "debe ser el mismo miembro"
        assert token_a != token_b, "pero un token nuevo"
        assert token_b, "el token nuevo funciona"

    async def test_cannot_join_inactive_server(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Un servidor apagado no acepta gente."""
        await server_services.deactivate_server(session, server)

        with pytest.raises(ServerInactiveError):
            await join(session, server, "ana")

    async def test_nickname_is_unique_within_server(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        await join(session, server, "ana")
        same = await join(session, server, "ana")

        # No es un error: es la misma persona volviendo a entrar.
        assert same.nickname == "ana"


# ──────────────────────────────────────────────────────────────────────────────
# La regla central: el mismo nickname en dos servidores es otra persona
# ──────────────────────────────────────────────────────────────────────────────


class TestIdentityIsScopedToServer:
    async def test_same_nickname_two_servers_two_people(self, session: AsyncSession) -> None:
        """El comportamiento central del producto, fijado por un test.

        "ana" en `casa-de-luis` y "ana" en `gym-de-martes` son dos personas sin
        relación. Si alguien cambia esto, rompe la propuesta de valor.
        """
        server_a = await server_services.create_server(
            session,
            ServerCreate(name="Casa de Luis", slug="casa-de-luis", owner_nickname="luis"),
        )
        server_b = await server_services.create_server(
            session,
            ServerCreate(name="Gym", slug="gym-de-martes", owner_nickname="mari"),
        )

        ana_a, token_a, _ = await services.join_server(
            session, server_a, JoinRequest(nickname="ana")
        )
        ana_b, token_b, _ = await services.join_server(
            session, server_b, JoinRequest(nickname="ana")
        )

        # Mismo nickname, personas distintas.
        assert ana_a.nickname == ana_b.nickname == "ana"
        assert ana_a.id != ana_b.id
        assert ana_a.server_id != ana_b.server_id

        # Y el token de una no abre la otra. Esto es lo que hace que la identidad
        # no sea global.
        authenticated_a = await services.authenticate(session, token_a)
        assert authenticated_a.id == ana_a.id

        authenticated_b = await services.authenticate(session, token_b)
        assert authenticated_b.id == ana_b.id


# ──────────────────────────────────────────────────────────────────────────────
# Autenticación
# ──────────────────────────────────────────────────────────────────────────────


class TestAuthenticate:
    async def test_valid_token_resolves_to_member(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        member, token, _ = await services.join_server(session, server, JoinRequest(nickname="ana"))

        authenticated = await services.authenticate(session, token)

        assert authenticated.id == member.id

    async def test_empty_token_fails(self, session: AsyncSession) -> None:
        with pytest.raises(AuthenticationError) as exc:
            await services.authenticate(session, "")
        assert exc.value.code == "missing_token"

    async def test_garbage_token_fails(self, session: AsyncSession) -> None:
        with pytest.raises(AuthenticationError) as exc:
            await services.authenticate(session, "no-es-un-token-real")
        assert exc.value.code == "invalid_token"

    async def test_revoked_token_fails(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Revocar tiene que servir para algo: cortar el acceso."""
        _, token, _ = await services.join_server(session, server, JoinRequest(nickname="ana"))
        await services.revoke_token(session, token)

        with pytest.raises(AuthenticationError):
            await services.authenticate(session, token)

    async def test_expired_token_fails(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        from apps.common.types import utcnow

        _member, token, _ = await services.join_server(session, server, JoinRequest(nickname="ana"))
        stored = await _stored_token(session, token)
        stored.expires_at = utcnow().replace(year=2000)  # ya venció
        await session.flush()

        with pytest.raises(AuthenticationError):
            await services.authenticate(session, token)

    async def test_revoke_all_cuts_every_device(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """`logout-all` sirve para cuando pensás que te robaron la sesión."""
        _, token_phone, _ = await services.join_server(session, server, JoinRequest(nickname="ana"))
        _, token_pc, _ = await services.join_server(session, server, JoinRequest(nickname="ana"))

        member = await services.authenticate(session, token_phone)
        revoked = await services.revoke_all_tokens(session, member)

        assert revoked >= 2
        for bad in (token_phone, token_pc):
            with pytest.raises(AuthenticationError):
                await services.authenticate(session, bad)


async def _stored_token(session: AsyncSession, raw: str):  # type: ignore[no-untyped-def]
    """El token tal como quedó guardado. Para poder corruptarlo en los tests."""
    from sqlalchemy import select

    from apps.identity.models import MemberToken

    stmt = select(MemberToken).where(MemberToken.token_hash == services.hash_token(raw))
    stored = (await session.execute(stmt)).scalar_one()
    return stored


# ──────────────────────────────────────────────────────────────────────────────
# Un servidor nunca queda sin dueño
# ──────────────────────────────────────────────────────────────────────────────


class TestOwnership:
    async def test_owner_leaving_promotes_the_oldest_member(
        self, session: AsyncSession, server
    ) -> None:  # type: ignore[no-untyped-def]
        """Si el dueño se va, el rol pasa a quien quede más antiguo."""
        owner = await join(session, server, "luis")
        first = await join(session, server, "ana")
        second = await join(session, server, "bob")

        assert owner.role_enum is Role.OWNER

        await services.leave_server(session, owner)

        refreshed = await services.get_member_by_nickname(session, server.id, "ana")
        assert refreshed.role_enum is Role.OWNER, "el más antiguo hereda el rol"
        assert refreshed.id == first.id
        assert second.id != first.id

    async def test_last_member_leaving_leaves_no_owner(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Si se va el último, no hay a quién darle el rol.

        No es un error: es un servidor vacío, que puede quedar así.
        """
        only_member = await join(session, server, "luis")

        await services.leave_server(session, only_member)

        assert await services.member_count(session, server.id) == 0

    async def test_admin_cannot_kick_the_owner(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Ni siquiera un admin puede expulsar al dueño.

        El dueño se va si quiere. Sacarlo a la fuerza dejaría al servidor en manos
        de cualquiera con permiso de administración.
        """
        owner = await join(session, server, "luis")
        admin = await join(session, server, "ana")
        admin.role = Role.ADMIN
        owner.role = Role.OWNER
        await session.flush()

        with pytest.raises(PermissionDeniedError) as exc:
            await services.kick_member(session, admin, owner)
        assert exc.value.code == "role_hierarchy"

        # Y el dueño sigue ahí, intacto.
        assert await services.member_count(session, server.id) == 2


# ──────────────────────────────────────────────────────────────────────────────
# Permisos
# ──────────────────────────────────────────────────────────────────────────────


class TestKick:
    async def test_admin_can_kick_a_member(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        owner = await join(session, server, "luis")
        victim = await join(session, server, "ana")
        owner.role = Role.OWNER
        await session.flush()

        await services.kick_member(session, owner, victim)

        assert await services.member_count(session, server.id) == 1

    async def test_member_cannot_kick(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        await join(session, server, "luis")
        bob = await join(session, server, "bob")
        victim = await join(session, server, "ana")

        with pytest.raises(PermissionDeniedError):
            await services.kick_member(session, bob, victim)

    async def test_cannot_kick_self(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        owner = await join(session, server, "luis")

        with pytest.raises(ValidationDomainError) as exc:
            await services.kick_member(session, owner, owner)
        assert exc.value.code == "cannot_kick_self"

    async def test_admin_cannot_kick_another_admin(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Un admin no saca a otro admin.

        Sin esto, dos admins se expulsan entre ellos y no queda nadie que
        pueda."""
        owner = await join(session, server, "luis")
        admin_a = await join(session, server, "ana")
        admin_b = await join(session, server, "bob")
        admin_a.role = Role.ADMIN
        admin_b.role = Role.ADMIN
        owner.role = Role.OWNER
        await session.flush()

        with pytest.raises(PermissionDeniedError) as exc:
            await services.kick_member(session, admin_a, admin_b)
        assert exc.value.code == "role_hierarchy"


class TestSetRole:
    async def test_owner_promotes_member_to_admin(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        owner = await join(session, server, "luis")
        member_to_promote = await join(session, server, "ana")

        await services.set_role(session, owner, member_to_promote, Role.ADMIN)

        refreshed = await services.get_member_by_nickname(session, server.id, "ana")
        assert refreshed.role_enum is Role.ADMIN

    async def test_member_cannot_change_roles(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        await join(session, server, "luis")
        bob = await join(session, server, "bob")
        ana = await join(session, server, "ana")

        with pytest.raises(PermissionDeniedError) as exc:
            await services.set_role(session, bob, ana, Role.ADMIN)
        assert exc.value.code == "not_admin"

    async def test_cannot_change_owner_role(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """El dueño se define al crear el servidor, no por un endpoint."""
        owner = await join(session, server, "luis")
        owner.role = Role.OWNER
        await session.flush()

        with pytest.raises(PermissionDeniedError) as exc:
            await services.set_role(session, owner, owner, Role.MEMBER)
        assert exc.value.code == "owner_role_immutable"


# ──────────────────────────────────────────────────────────────────────────────
# Lecturas
# ──────────────────────────────────────────────────────────────────────────────


class TestReads:
    async def test_find_by_nickname_is_case_insensitive(
        self, session: AsyncSession, server
    ) -> None:  # type: ignore[no-untyped-def]
        await join(session, server, "Ana")

        found = await services.get_member_by_nickname(session, server.id, "ANA")

        assert found.nickname == "ana"

    async def test_unknown_nickname_raises(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        with pytest.raises(NotFoundError) as exc:
            await services.get_member_by_nickname(session, server.id, "nadie")
        assert exc.value.code == "member_not_found_by_nickname"

    async def test_nickname_from_another_server_not_found(
        self, session: AsyncSession, server
    ) -> None:  # type: ignore[no-untyped-def]
        """Los miembros son de un servidor. Buscar en el equivocado no los ve."""
        other = await server_services.create_server(
            session, ServerCreate(name="Gym", slug="gym", owner_nickname="mari")
        )
        await join(session, other, "ana")

        with pytest.raises(NotFoundError):
            await services.get_member_by_nickname(session, server.id, "ana")

    async def test_list_members_sorted_by_nickname(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        for name in ("carlos", "ana", "bob"):
            await join(session, server, name)

        members, total = await services.list_members(session, server.id, limit=50, offset=0)

        assert total == 3
        assert [m.nickname for m in members] == ["ana", "bob", "carlos"]

    async def test_member_count(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        for name in ("a1", "b2", "c3"):
            await join(session, server, name)

        assert await services.member_count(session, server.id) == 3

    async def test_delete_server_cascades_to_members(self, session: AsyncSession, server) -> None:  # type: ignore[no-untyped-def]
        """Borrar el servidor borra a sus miembros y sus tokens."""
        from sqlalchemy import text

        await join(session, server, "luis")
        await join(session, server, "ana")
        server_id = server.id
        await session.flush()

        await server_services.delete_server(session, server)
        await session.flush()

        remaining = await session.execute(
            text("SELECT count(*) FROM members WHERE server_id = :i"), {"i": str(server_id)}
        )
        assert remaining.scalar_one() == 0

        tokens = await session.execute(
            text("SELECT count(*) FROM member_tokens WHERE server_id = :i"),
            {"i": str(server_id)},
        )
        assert tokens.scalar_one() == 0
