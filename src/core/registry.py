"""Django-style app registry; explicit list keeps migration order deterministic.

New module: create src/<name>/, then add it to INSTALLED_APPS.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter

from common.view import router as common_router
from identity.view import router as identity_router
from node.view import router as node_router
from servers.calls_view import router as calls_router
from servers.view import router as servers_router


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Registered app config."""

    name: str
    router: APIRouter
    prefix: str = ""
    tags: tuple[str, ...] = ()


# Order matters: Alembic walks models in this order; base apps first.
INSTALLED_APPS: tuple[AppConfig, ...] = (
    AppConfig(name="common", router=common_router),
    AppConfig(name="node", router=node_router, prefix="/node", tags=("nodo",)),
    AppConfig(name="identity", router=identity_router, tags=("identidad",)),
    AppConfig(name="servers", router=servers_router, prefix="/servers", tags=("servidores",)),
    AppConfig(name="calls", router=calls_router, prefix="/servers", tags=("llamadas",)),
)


class AppRegistry:
    """Active apps and their assembled routers."""

    def __init__(self, installed: tuple[AppConfig, ...] = INSTALLED_APPS) -> None:
        self._installed = installed

    @property
    def installed(self) -> tuple[str, ...]:
        return tuple(app.name for app in self._installed)

    def build_router(self) -> APIRouter:
        """Router combining all registered app routers."""
        router = APIRouter()
        for app in self._installed:
            router.include_router(app.router, prefix=app.prefix, tags=list(app.tags) or [app.name])
        return router


app_registry = AppRegistry()
