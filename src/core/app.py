from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.conf import Settings, get_settings
from core import __version__
from core.api.errors import register_exception_handlers
from core.api.health import router as health_router
from core.registry import app_registry

if TYPE_CHECKING:
    from core.supervisor import GroupSupervisor

logger = logging.getLogger(__name__)

def _base_app(settings: Settings, *, lifespan: object | None) -> FastAPI:
    app = FastAPI(
        title="Recop",
        summary="Self-hosted chat. Your server, your machine, your port.",
        version=__version__,
        root_path=settings.root_path,
        debug=settings.debug,
        lifespan=lifespan,  # type: ignore[arg-type]
        openapi_url=f"{settings.root_path}/openapi.json",
        docs_url=f"{settings.root_path}/docs",
        redoc_url=f"{settings.root_path}/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    root = APIRouter()
    root.include_router(health_router)
    app.include_router(root)
    app.include_router(app_registry.build_router(), prefix="/api/v1")

    return app


def create_node_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        from core.db.session import dispose_engine

        supervisor: GroupSupervisor | None = getattr(app.state, "supervisor", None)
        try:
            if supervisor is not None:
                await supervisor.start()
            yield
        finally:
            if supervisor is not None:
                await supervisor.stop()
            await dispose_engine()

    return _base_app(settings, lifespan=lifespan)


def create_group_app(*, server_id: str, settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        from core.db.session import dispose_engine

        app.state.server_id = server_id
        try:
            yield
        finally:
            await dispose_engine()

    app = _base_app(settings, lifespan=lifespan)
    app.state.server_id = server_id
    return app


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        from core.db.session import dispose_engine, session_scope
        from servers.repository import mark_all_inactive

        try:
            async with session_scope() as session:
                await mark_all_inactive(session)
        except Exception:
            logger.exception("could not reconcile group state at startup; is PostgreSQL up?")

        try:
            yield
        finally:
            await dispose_engine()

    return _base_app(settings, lifespan=lifespan)


app = create_app()
