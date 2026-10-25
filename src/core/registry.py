from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter

from calls.view import router as calls_router
from channels.view import router as channels_router
from common.view import router as common_router
from events.view import router as events_router
from identity.view import router as identity_router
from messages.view import router as messages_router
from node.view import router as node_router
from servers.view import router as servers_router


@dataclass(frozen=True, slots=True)
class AppConfig:
    name: str
    router: APIRouter
    prefix: str = ""
    tags: tuple[str, ...] = ()


INSTALLED_APPS: tuple[AppConfig, ...] = (
    AppConfig(name="common", router=common_router),
    AppConfig(name="node", router=node_router, prefix="/node", tags=("node",)),
    AppConfig(name="identity", router=identity_router, tags=("identity",)),
    AppConfig(name="servers", router=servers_router, prefix="/servers", tags=("servers",)),
    AppConfig(name="calls", router=calls_router, prefix="/servers", tags=("calls",)),
    AppConfig(name="channels", router=channels_router, prefix="/servers", tags=("channels",)),
    AppConfig(name="messages", router=messages_router, tags=("messages",)),
    AppConfig(name="events", router=events_router, tags=("events",)),
)


class AppRegistry:
    def __init__(self, installed: tuple[AppConfig, ...] = INSTALLED_APPS) -> None:
        self._installed = installed

    @property
    def installed(self) -> tuple[str, ...]:
        return tuple(app.name for app in self._installed)

    def build_router(self) -> APIRouter:
        router = APIRouter()
        for app in self._installed:
            router.include_router(app.router, prefix=app.prefix, tags=list(app.tags) or [app.name])
        return router


app_registry = AppRegistry()
