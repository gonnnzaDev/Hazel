"""Registro de apps, al estilo Django.

Una "app" es un módulo autocontenido bajo `apps/` que agrupa sus modelos,
schemas, servicios y rutas. Acá se declara explícitamente cuáles están activas,
para que el orden de importación de las migraciones sea determinista y no
dependa de que alguien importe un módulo por accidente.

Para agregar una app nueva:
  1. Creá `apps/<nombre>/` con `models.py`, `schemas.py`, `services.py`, `api/`.
  2. Registrala acá en la lista `INSTALLED_APPS`.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter

from apps.common.api.router import router as common_router
from apps.identity.api.router import router as identity_router
from apps.node.api.router import router as node_router
from apps.servers.api.calls import router as calls_router
from apps.servers.api.router import router as servers_router


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Configuración de una app registrada."""

    name: str
    router: APIRouter
    prefix: str = ""
    tags: tuple[str, ...] = ()


# El orden importa: Alembic autogenera migraciones recorriendo los modelos en
# este orden, así que las apps base van primero.
INSTALLED_APPS: tuple[AppConfig, ...] = (
    AppConfig(name="common", router=common_router),
    AppConfig(name="node", router=node_router, prefix="/node", tags=("nodo",)),
    AppConfig(name="identity", router=identity_router, tags=("identidad",)),
    AppConfig(name="servers", router=servers_router, prefix="/servers", tags=("servidores",)),
    AppConfig(name="calls", router=calls_router, prefix="/servers", tags=("llamadas",)),
)


class AppRegistry:
    """Colección de apps activas y ensamble de sus routers."""

    def __init__(self, installed: tuple[AppConfig, ...] = INSTALLED_APPS) -> None:
        self._installed = installed

    @property
    def installed(self) -> tuple[str, ...]:
        return tuple(app.name for app in self._installed)

    def build_router(self) -> APIRouter:
        """Devuelve un router con los routers de todas las apps registradas."""
        router = APIRouter()
        for app in self._installed:
            router.include_router(app.router, prefix=app.prefix, tags=list(app.tags) or [app.name])
        return router


app_registry = AppRegistry()
