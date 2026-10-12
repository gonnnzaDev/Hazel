"""Ensamblado de la API. Tres apps, tres procesos distintos.

| App | Qué es | Dónde escucha |
|---|---|---|
| **nodo** | El plano de control del dueño. Crea, enciende y apaga grupos. | `RECOP_PORT` |
| **grupo** | Un grupo. Sirve el chat de ese grupo y nada más. | un puerto por grupo |
| **todo** | Las dos cosas en un proceso. Para desarrollo y tests. | `RECOP_PORT` |

## Por qué el grupo no puede ver otros grupos

Un proceso de grupo se ata a un `server_id` y filtra todo por él. No es una
optimización: es la garantía de que un proceso no pueda responder por un grupo
que no es suyo. Si el filtro fallara, el proceso de `gym-de-martes` serviría los
mensajes de `casa-de-luis`, y eso no es un bug que se pueda arreglar después.

El filtro vive en `core/group_scope.py`, que es una dependencia de FastAPI: todo
endpoint que toque datos de un grupo la usa, y si se olvida, el servidor_group no
arranca (ver `assert_group_scoped`).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import __version__
from core.api.errors import register_exception_handlers
from core.api.health import router as health_router
from core.config import Settings, get_settings
from core.registry import app_registry

if TYPE_CHECKING:
    from core.supervisor import GroupSupervisor

logger = logging.getLogger(__name__)


def _base_app(settings: Settings, *, lifespan: object | None) -> FastAPI:
    """La app con todo lo que los tres roles comparten."""
    app = FastAPI(
        title="Recop",
        summary="Chat autoservido. Tu servidor, tu máquina, tu puerto.",
        version=__version__,
        root_path=settings.root_path,
        debug=settings.debug,
        lifespan=lifespan,  # type: ignore[arg-type]
        openapi_url=f"{settings.root_path}/openapi.json",
        docs_url=f"{settings.root_path}/docs",
        redoc_url=f"{settings.root_path}/redoc",
    )

    # El cliente de PC y el futuro de mobile consumen este mismo contrato, así
    # que los orígenes se configuran en vez de dejarlo abierto.
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
    """El proceso del nodo: el panel del dueño.

    Acá se crean los grupos, se les asigna un puerto y se levantan sus procesos.
    """
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
    """Un proceso de grupo: sirve un grupo y solo ese.

    La reconciliación de estado la hace el nodo, no el grupo: si un grupo al
    arrancar marcara todo como inactivo, apagaría a sus hermanos.
    """
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
    """Nodo y grupos en un solo proceso.

    Para desarrollo rápido y para los tests: levantar la app entera sin tener
    que hablar con el supervisor. En producción, el dueño corre el nodo y este
    levanta los grupos de verdad.
    """
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        from apps.servers.services import mark_all_inactive
        from core.db.session import dispose_engine, session_scope

        try:
            async with session_scope() as session:
                await mark_all_inactive(session)
        except Exception:
            logger.exception("no se pudo reconciliar el estado de los grupos al arrancar")

        try:
            yield
        finally:
            await dispose_engine()

    return _base_app(settings, lifespan=lifespan)


#: La app que usan `uvicorn core.app:app`.
app = create_app()
