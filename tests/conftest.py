"""In-memory test environment.

PostgreSQL isn't needed for the unit-level suite: tests run against SQLite
with a JSONB compiler shim. PostgreSQL-only behaviour (pg_database_size,
FOR UPDATE SKIP LOCKED) is either caught by the code or covered by integration
tests against HAZEL_TEST_DATABASE_URL.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

import config.bdd_config.bdd_config as bdd
import core.api.deps as deps
from common.types import RecordId

STORAGE_ROOT = Path(tempfile.mkdtemp(prefix="hazel-tests-"))
os.environ.update(
    HAZEL_SECRET_KEY="test-only-secret",
    HAZEL_ADMIN_TOKEN="test-admin-token",
    HAZEL_DATABASE_URL="sqlite+aiosqlite://",
    HAZEL_STORAGE_ROOT=str(STORAGE_ROOT),
    HAZEL_ENV="test",
)


@compiles(JSONB, "sqlite")
def _jsonb_as_json(type_: object, compiler: object, **kw: object) -> str:
    return "JSON"


@pytest.fixture
async def db(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[AsyncEngine, async_sessionmaker[AsyncSession]]]:
    import channels.model  # noqa: F401
    import events.model  # noqa: F401
    import identity.model  # noqa: F401
    import messages.model  # noqa: F401
    import servers.model  # noqa: F401
    from config.bdd_config.bdd_config import Base

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

    monkeypatch.setattr(bdd, "get_engine", lambda: engine)
    monkeypatch.setattr(bdd, "get_session_maker", lambda: maker)
    monkeypatch.setattr(deps, "get_session_maker", lambda: maker)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    try:
        yield engine, maker
    finally:
        await engine.dispose()


@pytest.fixture
async def session(
    db: tuple[AsyncEngine, async_sessionmaker[AsyncSession]],
) -> AsyncIterator[AsyncSession]:
    _, maker = db
    async with maker() as value:
        yield value


@pytest.fixture
async def client(
    db: tuple[AsyncEngine, async_sessionmaker[AsyncSession]],
) -> AsyncIterator[AsyncClient]:
    from core.app import create_app

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value


@pytest.fixture
async def server_id(session: AsyncSession) -> RecordId:
    from common.types import new_id
    from identity.model import Member
    from identity.roles import Role
    from servers.model import Server
    from servers.states import ServerStatus

    server = Server(
        id=new_id(),
        name="Test House",
        slug="test-house",
        description=None,
        status=ServerStatus.ACTIVE,
        bind_port=17272,
        max_members=50,
    )
    member = Member(
        id=new_id(),
        server_id=server.id,
        nickname="tester",
        display_name="Tester",
        role=Role.OWNER,
        is_online=False,
    )
    session.add_all([server, member])
    await session.commit()
    return server.id


ADMIN_HEADERS = {"Authorization": "Bearer test-admin-token"}
