"""The four section-10 endpoints of docs/api.md."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from common.types import RecordId

ADMIN_HEADERS = {"Authorization": "Bearer test-admin-token"}

BASE = "/api/v1/servers"


async def test_stats(client: AsyncClient, server_id: RecordId) -> None:
    response = await client.get(f"{BASE}/{server_id}/stats", headers=ADMIN_HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert body["server_id"] == str(server_id)
    assert body["members"] == 1
    assert body["messages"] == 0
    assert body["attachment_bytes"] == 0
    assert body["db_bytes"] == 0  # pg_database_size falls back on SQLite


async def test_audit_events(
    client: AsyncClient, session: AsyncSession, server_id: RecordId
) -> None:
    from common.types import new_id
    from servers.model import AuditEvent

    session.add(
        AuditEvent(
            id=new_id(),
            server_id=server_id,
            actor_nickname="tester",
            action="server.created",
            target_type="server",
            target_id=str(server_id),
            data={"origin": "test"},
        )
    )
    await session.commit()

    response = await client.get(f"{BASE}/{server_id}/events", headers=ADMIN_HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["limit"] == 50
    assert body["items"][0]["action"] == "server.created"
    assert body["items"][0]["data"] == {"origin": "test"}


async def test_backup_writes_file_and_restore_reads_it(
    client: AsyncClient, server_id: RecordId
) -> None:
    created = await client.post(f"{BASE}/{server_id}/backup", headers=ADMIN_HEADERS)
    assert created.status_code == 200
    backup = created.json()
    path = Path(backup["path"])
    assert await asyncio.to_thread(path.is_file)
    content = await asyncio.to_thread(path.read_text)
    assert json.loads(content)["server_id"] == str(server_id)

    restored = await client.post(
        f"{BASE}/{server_id}/restore",
        headers=ADMIN_HEADERS,
        json={"backup_id": backup["backup_id"]},
    )
    assert restored.status_code == 200
    assert restored.json()["id"] == str(server_id)


async def test_restore_validation(client: AsyncClient, server_id: RecordId) -> None:
    empty = await client.post(f"{BASE}/{server_id}/restore", headers=ADMIN_HEADERS, json={})
    assert empty.status_code == 422
    assert empty.json()["code"] == "invalid_restore_request"

    missing = await client.post(
        f"{BASE}/{server_id}/restore",
        headers=ADMIN_HEADERS,
        json={"backup_id": "does-not-exist"},
    )
    assert missing.status_code == 404
    assert missing.json()["code"] == "backup_not_found"


async def test_maintenance_requires_admin_token(client: AsyncClient, server_id: RecordId) -> None:
    response = await client.get(f"{BASE}/{server_id}/stats")
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_admin_token"


async def test_lifecycle_actions_write_audit(client: AsyncClient, server_id: RecordId) -> None:
    activated = await client.post(f"{BASE}/{server_id}/activate", headers=ADMIN_HEADERS)
    assert activated.status_code == 200

    events = await client.get(f"{BASE}/{server_id}/events", headers=ADMIN_HEADERS)
    assert any(item["action"] == "server.activated" for item in events.json()["items"])
