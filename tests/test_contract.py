"""Guardrails for the endpoints documented in docs/api.md."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from starlette.routing import BaseRoute

from core.app import create_app

EXPECTED_PATHS = {
    "/api/v1/node",
    "/api/v1/node/address",
    "/api/v1/servers",
    "/api/v1/servers/{server_id}",
    "/api/v1/servers/by-slug/{slug}",
    "/api/v1/servers/{server_id}/activate",
    "/api/v1/servers/{server_id}/deactivate",
    "/api/v1/servers/{server_id}/heartbeat",
    "/api/v1/servers/{server_id}/address",
    "/api/v1/servers/{server_id}/join",
    "/api/v1/servers/{server_id}/leave",
    "/api/v1/servers/{server_id}/members",
    "/api/v1/servers/{server_id}/members/{nickname}",
    "/api/v1/servers/{server_id}/members/{nickname}/role",
    "/api/v1/servers/{server_id}/channels",
    "/api/v1/servers/{server_id}/channels/{channel_id}",
    "/api/v1/servers/{server_id}/channels/{channel_id}/join",
    "/api/v1/servers/{server_id}/channels/{channel_id}/call/participants",
    "/api/v1/servers/{server_id}/invites",
    "/api/v1/invites/{code}",
    "/api/v1/servers/{server_id}/stats",
    "/api/v1/servers/{server_id}/backup",
    "/api/v1/servers/{server_id}/restore",
    "/api/v1/servers/{server_id}/events",
    "/api/v1/channels/{channel_id}/messages",
    "/api/v1/channels/{channel_id}/messages/{message_id}",
    "/api/v1/channels/{channel_id}/messages/{message_id}/reactions",
    "/api/v1/channels/{channel_id}/messages/{message_id}/reactions/{emoji}",
    "/api/v1/channels/{channel_id}/attachments",
    "/api/v1/attachments/{attachment_id}",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/auth/logout-all",
    "/api/v1/me",
}


def test_openapi_exposes_contract_paths() -> None:
    paths = set(create_app().openapi()["paths"])
    assert paths >= EXPECTED_PATHS


def _all_routes(node: object) -> Iterator[BaseRoute]:
    """Walk the nested routers FastAPI 0.143 keeps behind _IncludedRouter."""
    for route in getattr(node, "routes", []):
        if type(route).__name__ == "_IncludedRouter":
            yield from _all_routes(route.original_router)
        else:
            yield route


def test_websocket_routes_exist() -> None:
    from starlette.routing import WebSocketRoute

    sockets = {
        route.path for route in _all_routes(create_app()) if isinstance(route, WebSocketRoute)
    }
    assert "/ws" in sockets
    assert "/{server_id}/channels/{channel_id}/call" in sockets


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/api/v1/servers/{server_id}/stats", "get"),
        ("/api/v1/servers/{server_id}/events", "get"),
        ("/api/v1/servers/{server_id}/backup", "post"),
        ("/api/v1/servers/{server_id}/restore", "post"),
        ("/api/v1/servers/{server_id}/members/{nickname}/role", "put"),
        ("/api/v1/servers/{server_id}/channels/{channel_id}/call/participants", "get"),
    ],
)
def test_contract_operations(path: str, method: str) -> None:
    schema = create_app().openapi()
    assert method in schema["paths"][path]
