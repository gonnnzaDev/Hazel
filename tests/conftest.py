"""Fixtures compartidas.

Las variables de entorno se fijan *antes* de importar la app, porque `Settings`
lee el entorno al instanciarse y está cacheada a nivel de proceso.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest

os.environ.setdefault("RECOP_ENV", "test")
os.environ.setdefault("RECOP_SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ.setdefault("RECOP_DEBUG", "true")

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def settings() -> Any:
    from core.config import get_settings

    get_settings.cache_clear()
    return get_settings()


@pytest.fixture
def app() -> FastAPI:
    from core.app import create_app

    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """Cliente HTTP contra la app, sin levantar un servidor real."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


@pytest.fixture
def anyio_backend_name() -> Iterator[str]:  # pragma: no cover
    yield "asyncio"
