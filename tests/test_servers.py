"""Tests del ciclo de vida del servidor.

Estos tests corren contra **PostgreSQL de verdad**, no contra un mock. El ciclo
de vida de un servidor es exactamente el tipo de lógica donde un fake te deja
pasar bugs reales: los CHECK constraints, las claves foráneas y los tipos ENUM
solo existen en la base.

Para correrlos hace falta una base reachable:

    createdb recap_test
    RECOP_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/recap_test \
        uv run pytest

Si `RECOP_TEST_DATABASE_URL` no está definida, los tests de integración se
omiten en vez de fallar, así que `pytest` sigue sirviendo en un entorno sin
infraestructura.
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from apps.common.types import RecordId, new_id
from apps.servers import services
from apps.servers.models import Channel, Server
from apps.servers.schemas import ChannelCreate, ServerCreate, ServerUpdate
from apps.servers.states import ServerStatus
from core.api.errors import (
    ConflictError,
    NotFoundError,
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
    """Sesión limpia sobre una base real.

    Cada test corre dentro de una transacción que se revierte al final, así que
    los tests no se pisan entre sí y la base queda como estaba.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=None)
    connection = await engine.connect()
    transaction = await connection.begin()
    session_maker = async_sessionmaker(bind=connection, expire_on_commit=False)

    async with session_maker() as s:
        yield s

    await transaction.rollback()
    await connection.close()
    await engine.dispose()


def make_payload(**overrides: object) -> ServerCreate:
    """Payload de creación con valores por defecto válidos."""
    data: dict[str, object] = {
        "name": "Casa de Luis",
        "slug": "casa-de-luis",
        "owner_nickname": "luis",
        "bind_host": "0.0.0.0",
        "bind_port": 7272,
        "max_members": 50,
        "channels": [],
    }
    data.update(overrides)
    return ServerCreate(**data)  # type: ignore[arg-type]


# ──────────────────────────────────────────────────────────────────────────────
# Creación
# ──────────────────────────────────────────────────────────────────────────────


class TestCreateServer:
    async def test_create_leaves_the_server_running(self, session: AsyncSession) -> None:
        """Desplegar un servidor implica que quede escuchando.

        Es la promesa del producto: si el dueño despliega, el puerto se abre.
        """
        server = await services.create_server(session, make_payload())

        assert server.status is ServerStatus.ACTIVE
        assert server.status.accepts_traffic
        assert server.last_heartbeat_at is not None

    async def test_create_normalizes_the_slug(self, session: AsyncSession) -> None:
        server = await services.create_server(
            session, make_payload(name="Vereda Grande", slug="Vereda Grande")
        )
        assert server.slug == "vereda-grande"

    async def test_create_adds_a_default_channel(self, session: AsyncSession) -> None:
        """Un servidor sin canales igual tiene dónde caer la gente."""
        server = await services.create_server(session, make_payload())

        assert len(server.channels) == 1
        assert server.channels[0].name == "general"
        assert server.channels[0].is_default is True

    async def test_create_keeps_provided_channels(self, session: AsyncSession) -> None:
        server = await services.create_server(
            session,
            make_payload(
                channels=[
                    ChannelCreate(name="general", is_default=True),
                    ChannelCreate(name="games", position=1),
                ]
            ),
        )

        names = {c.name for c in server.channels}
        assert names == {"general", "games"}

    async def test_create_promotes_first_channel_to_default(self, session: AsyncSession) -> None:
        """Si nadie marcó un canal por defecto, el primero lo asume."""
        server = await services.create_server(
            session,
            make_payload(channels=[ChannelCreate(name="lobby"), ChannelCreate(name="sala")]),
        )

        assert sum(c.is_default for c in server.channels) == 1
        assert next(c for c in server.channels if c.is_default).name == "lobby"

    async def test_rejects_two_default_channels(self, session: AsyncSession) -> None:
        with pytest.raises(ValidationDomainError) as exc:
            await services.create_server(
                session,
                make_payload(
                    channels=[
                        ChannelCreate(name="a", is_default=True),
                        ChannelCreate(name="b", is_default=True),
                    ]
                ),
            )
        assert exc.value.code == "multiple_default_channels"

    async def test_rejects_invalid_channel_kind(self, session: AsyncSession) -> None:
        with pytest.raises(ValidationDomainError) as exc:
            await services.create_server(
                session, make_payload(channels=[ChannelCreate(name="x", kind="hologram")])
            )
        assert exc.value.code == "invalid_channel_kind"

    async def test_rejects_duplicate_slug(self, session: AsyncSession) -> None:
        await services.create_server(session, make_payload())

        with pytest.raises(ConflictError) as exc:
            await services.create_server(session, make_payload(bind_port=7273))
        assert exc.value.code == "slug_taken"

    async def test_rejects_port_already_in_use(self, session: AsyncSession) -> None:
        """Dos servidores activos no pueden escuchar en el mismo puerto."""
        await services.create_server(session, make_payload())

        with pytest.raises(ConflictError) as exc:
            await services.create_server(session, make_payload(slug="otro-casa"))
        assert exc.value.code == "port_taken"

    async def test_freed_port_can_be_reused(self, session: AsyncSession) -> None:
        """Un servidor apagado libera su puerto."""
        first = await services.create_server(session, make_payload())
        await services.deactivate_server(session, first)

        second = await services.create_server(session, make_payload(slug="casa-de-ana"))
        assert second.bind_port == 7272
        assert second.status is ServerStatus.ACTIVE

    async def test_persists_to_the_database(self, session: AsyncSession) -> None:
        """No alcanza con el objeto en memoria: tiene que estar en la tabla."""
        created = await services.create_server(session, make_payload())

        found = await session.execute(
            text("SELECT name, slug, status FROM servers WHERE id = :id"),
            {"id": str(created.id)},
        )
        row = found.one()
        assert row.name == "Casa de Luis"
        assert row.slug == "casa-de-luis"
        # El enum guarda el VALOR en minúscula, no el nombre del miembro.
        assert row.status == "active"


# ──────────────────────────────────────────────────────────────────────────────
# Desactivar: el comportamiento central del producto
# ──────────────────────────────────────────────────────────────────────────────


class TestDeactivate:
    async def test_deactivate_closes_the_port(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())

        await services.deactivate_server(session, server)

        assert server.status is ServerStatus.INACTIVE
        assert not server.status.accepts_traffic

    async def test_deactivate_keeps_all_data(self, session: AsyncSession) -> None:
        """Apagar el servidor no borra nada.

        Este es el test más importante del PR. El producto promete que si el
        dueño apaga su servidor, puede volver a encenderlo y encontrar todo
        intacto.
        """
        server = await services.create_server(
            session,
            make_payload(
                channels=[
                    ChannelCreate(name="general", is_default=True),
                    ChannelCreate(name="games", position=1),
                ]
            ),
        )
        server_id = server.id
        channel_names_before = sorted(c.name for c in server.channels)

        await services.deactivate_server(session, server)

        await session.refresh(server)
        reloaded = await services.get_server(session, server_id)

        assert reloaded.status is ServerStatus.INACTIVE
        assert sorted(c.name for c in reloaded.channels) == channel_names_before
        assert reloaded.name == "Casa de Luis"
        assert reloaded.slug == "casa-de-luis"

    async def test_deactivate_is_idempotent(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())

        await services.deactivate_server(session, server)
        await services.deactivate_server(session, server)  # no explota

        assert server.status is ServerStatus.INACTIVE


# ──────────────────────────────────────────────────────────────────────────────
# Activar
# ──────────────────────────────────────────────────────────────────────────────


class TestActivate:
    async def test_reactivate_reopens_the_same_server(self, session: AsyncSession) -> None:
        """Apagar y encender devuelve el mismo servidor con todo dentro."""
        server = await services.create_server(
            session, make_payload(channels=[ChannelCreate(name="general", is_default=True)])
        )
        server_id = server.id

        await services.deactivate_server(session, server)
        await services.activate_server(session, server)

        reloaded = await services.get_server(session, server_id)
        assert reloaded.id == server_id
        assert reloaded.status is ServerStatus.ACTIVE
        assert len(reloaded.channels) == 1

    async def test_activate_when_already_active_is_a_noop(self, session: AsyncSession) -> None:
        """Encender algo ya encendido no es un error.

        Permite que el dueño ponga 'encender mi servidor' en su flujo sin
        consultar el estado previo.
        """
        server = await services.create_server(session, make_payload())

        result = await services.activate_server(session, server)

        assert result.status is ServerStatus.ACTIVE

    async def test_cannot_activate_on_a_taken_port(self, session: AsyncSession) -> None:
        """No se puede encender un servidor cuyo puerto tomó otro."""
        first = await services.create_server(session, make_payload())
        await services.create_server(session, make_payload(slug="casa-de-ana", bind_port=7273))

        # first quedó activo; lo apagamos y apagamos el otro para liberar 7272,
        # luego otro lo ocupa.
        await services.deactivate_server(session, first)
        second = await services.resolve_by_slug(session, "casa-de-ana")
        await services.deactivate_server(session, second)

        # Ahora alguien más toma 7272.
        await services.create_server(session, make_payload(slug="casa-de-pedro", bind_port=7272))

        with pytest.raises(ConflictError) as exc:
            await services.activate_server(session, first)
        assert exc.value.code == "port_taken"


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliación al arrancar
# ──────────────────────────────────────────────────────────────────────────────


class TestMarkAllInactive:
    async def test_marks_active_servers_inactive_on_restart(self, session: AsyncSession) -> None:
        """Si el proceso se cerró, al volver a arrancar nadie escucha.

        Es exactamente el requisito: si el proceso se cae, el servidor queda
        inactivo, no muerto.
        """
        running = await services.create_server(session, make_payload())

        count = await services.mark_all_inactive(session)
        await session.flush()

        assert count == 1
        await session.refresh(running)
        assert running.status is ServerStatus.INACTIVE

    async def test_leaves_inactive_servers_untouched(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())
        await services.deactivate_server(session, server)

        count = await services.mark_all_inactive(session)

        assert count == 0

    async def test_servers_can_be_reactivated_after_restart(self, session: AsyncSession) -> None:
        """El ciclo crash → restart → reactivate tiene que cerrar."""
        server = await services.create_server(
            session, make_payload(channels=[ChannelCreate(name="general", is_default=True)])
        )
        server_id = server.id

        # El proceso se muere.
        await services.mark_all_inactive(session)
        await session.flush()

        # El dueño vuelve a encender su servidor.
        reloaded = await services.get_server(session, server_id)
        await services.activate_server(session, reloaded)

        assert reloaded.status is ServerStatus.ACTIVE
        assert len(reloaded.channels) == 1


# ──────────────────────────────────────────────────────────────────────────────
# Heartbeat
# ──────────────────────────────────────────────────────────────────────────────


class TestHeartbeat:
    async def test_heartbeat_updates_the_timestamp(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())
        before = server.last_heartbeat_at

        await services.heartbeat(session, server)

        assert server.last_heartbeat_at is not None
        assert server.last_heartbeat_at >= before


# ──────────────────────────────────────────────────────────────────────────────
# Lecturas
# ──────────────────────────────────────────────────────────────────────────────


class TestReads:
    async def test_get_missing_server_raises_not_found(self, session: AsyncSession) -> None:
        with pytest.raises(NotFoundError):
            await services.get_server(session, new_id())

    async def test_resolve_by_slug(self, session: AsyncSession) -> None:
        await services.create_server(session, make_payload())

        found = await services.resolve_by_slug(session, "casa-de-luis")
        assert found.name == "Casa de Luis"

    async def test_resolve_unknown_slug_raises_not_found(self, session: AsyncSession) -> None:
        with pytest.raises(NotFoundError) as exc:
            await services.resolve_by_slug(session, "no-existe")
        assert exc.value.code == "server_not_found_by_slug"

    async def test_list_returns_newest_first(self, session: AsyncSession) -> None:
        await services.create_server(session, make_payload(slug="uno", bind_port=7272))
        await services.create_server(session, make_payload(slug="dos", bind_port=7273))
        await services.create_server(session, make_payload(slug="tres", bind_port=7274))

        servers, total = await services.list_servers(session, limit=10, offset=0)

        assert total == 3
        assert [s.slug for s in servers] == ["tres", "dos", "uno"]

    async def test_list_paginates(self, session: AsyncSession) -> None:
        for i in range(5):
            await services.create_server(
                session, make_payload(slug=f"servidor-{i}", bind_port=7300 + i)
            )

        page, total = await services.list_servers(session, limit=2, offset=0)
        assert total == 5
        assert len(page) == 2

        page2, _ = await services.list_servers(session, limit=2, offset=2)
        assert len(page2) == 2
        assert page[0].id != page2[0].id


# ──────────────────────────────────────────────────────────────────────────────
# Actualizar y borrar
# ──────────────────────────────────────────────────────────────────────────────


class TestUpdate:
    async def test_update_partial_fields(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())

        updated = await services.update_server(
            session, server, ServerUpdate(name="Casa de Luis II", max_members=10)
        )

        assert updated.name == "Casa de Luis II"
        assert updated.max_members == 10
        assert updated.slug == "casa-de-luis"  # no se toca

    async def test_cannot_move_to_a_taken_port(self, session: AsyncSession) -> None:
        first = await services.create_server(session, make_payload())
        await services.create_server(session, make_payload(slug="otro", bind_port=7273))

        with pytest.raises(ConflictError) as exc:
            await services.update_server(session, first, ServerUpdate(bind_port=7273))
        assert exc.value.code == "port_taken"


class TestDelete:
    async def test_delete_removes_the_server_and_its_channels(self, session: AsyncSession) -> None:
        server = await services.create_server(
            session,
            make_payload(
                channels=[
                    ChannelCreate(name="general", is_default=True),
                    ChannelCreate(name="games", position=1),
                ]
            ),
        )
        server_id: RecordId = server.id
        await session.flush()

        await services.delete_server(session, server)
        await session.flush()

        with pytest.raises(NotFoundError):
            await services.get_server(session, server_id)

        remaining = await session.execute(
            text("SELECT count(*) FROM channels WHERE server_id = :id"),
            {"id": str(server_id)},
        )
        assert remaining.scalar_one() == 0

    async def test_delete_frees_the_slug(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())
        await services.delete_server(session, server)
        await session.flush()

        # Se puede volver a usar el mismo identificador después de eliminar.
        recreated = await services.create_server(session, make_payload(bind_port=7272))
        assert recreated.slug == "casa-de-luis"


# ──────────────────────────────────────────────────────────────────────────────
# Guardas
# ──────────────────────────────────────────────────────────────────────────────


class TestEnsureActive:
    async def test_passes_for_active_server(self, session: AsyncSession) -> None:
        server = await services.create_server(session, make_payload())
        services.ensure_active(server)  # no lanza

    async def test_fails_for_inactive_server(self, session: AsyncSession) -> None:
        """Escribir en un servidor apagado tiene que dar un error claro."""
        server = await services.create_server(session, make_payload())
        await services.deactivate_server(session, server)

        with pytest.raises(ServerInactiveError) as exc:
            services.ensure_active(server)

        assert exc.value.status_code == 409
        assert exc.value.code == "server_inactive"


# ──────────────────────────────────────────────────────────────────────────────
# Modelo
# ──────────────────────────────────────────────────────────────────────────────


class TestModels:
    async def test_channels_cascade_delete(self, session: AsyncSession) -> None:
        """`delete-orphan` + `ondelete=CASCADE`: los canales no quedan huérfanos."""
        server = Server(
            id=new_id(),
            name="Prueba",
            slug="prueba",
            bind_port=9999,
            channels=[Channel(id=new_id(), name="general", is_default=True)],
        )
        session.add(server)
        await session.flush()

        await session.delete(server)
        await session.flush()

        orphans = await session.execute(
            text("SELECT count(*) FROM channels WHERE server_id = :id"),
            {"id": str(server.id)},
        )
        assert orphans.scalar_one() == 0
