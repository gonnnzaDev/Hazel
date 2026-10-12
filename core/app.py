"""Ensamblado de la API: routers, middleware y ciclo de vida."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.servers.services import mark_all_inactive
from core import __version__
from core.api.errors import register_exception_handlers
from core.api.health import router as health_router
from core.config import get_settings
from core.db.session import dispose_engine, session_scope
from core.registry import app_registry

logger = logging.getLogger(__name__)


def create_api_router() -> APIRouter:
    """Router raíz. Las apps de `apps/` se enganchan acá desde `core/registry.py`."""
    return APIRouter()


def create_app() -> FastAPI:
    """App factory de Recop."""
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Startup y shutdown del proceso.

        Al arrancar se reconcilia el estado de los servidores: cualquier cosa que
        figure `ACTIVE` en la base pasó a estar inactiva, porque si el proceso
        anterior se cerró, ese puerto ya no está escuchando. Ver
        `apps.servers.services.mark_all_inactive`.
        """
        await _reconcile_server_state()

        yield

        await dispose_engine()

    async def _reconcile_server_state() -> None:
        """Deja el estado de los servidores consistente con la realidad."""
        try:
            async with session_scope() as session:
                await mark_all_inactive(session)
        except Exception:
            # Si la base no está disponible no queremos impedir que el nodo
            # levante: la API igual responde, solo que sin poder servir chat
            # hasta que la DB vuelva.
            logger.exception("no se pudo reconciliar el estado de los servidores al arrancar")

    app = FastAPI(
        title="Recop",
        summary="Chat autoservido. Tu servidor, tu máquina, tu puerto.",
        version=__version__,
        root_path=settings.root_path,
        debug=settings.debug,
        lifespan=lifespan,
        openapi_url=f"{settings.root_path}/openapi.json",
        docs_url=f"{settings.root_path}/docs",
    )

    # CORS: en producción se restringe a los orígenes configurados. El cliente
    # de PC y el futuro de mobile consumirán este mismo contrato.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    api_router = create_api_router()
    api_router.include_router(health_router)

    # Las apps registradas se montan bajo /api/v1
    app.include_router(api_router)
    app.include_router(app_registry.build_router(), prefix="/api/v1")

    return app


app = create_app()
