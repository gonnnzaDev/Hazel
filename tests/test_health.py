"""Tests de la capa de salud del nodo."""

from __future__ import annotations

from httpx import AsyncClient


async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "recop-node"
    assert body["environment"] == "test"


async def test_readiness_reports_kafka_not_wired(client: AsyncClient) -> None:
    """Readiness expone el panorama completo, aunque una dependencia falle.

    Este test verifica el contrato de la respuesta. Sin una base de datos mockeada
    el nodo no declara readiness, que es justamente el comportamiento esperado
    en un entorno de test sin infraestructura.
    """
    response = await client.get("/health/ready")
    body = response.json()

    # Ambas dependencias se reportan siempre, pass o fail.
    assert set(body["checks"]) == {"database", "kafka"}
    assert body["checks"]["kafka"] == "not_wired"

    # Sin DB disponible el nodo no debe declarar readiness.
    if response.status_code != 200:
        assert response.status_code == 503
        assert body["status"] == "unavailable"
        assert str(body["checks"]["database"]).startswith("error")
    else:
        assert body["status"] == "ready"
        assert body["checks"]["database"] == "ok"


async def test_openapi_is_generated(client: AsyncClient) -> None:
    """El contrato de la API se documenta solo, base para el cliente mobile."""
    response = await client.get("/openapi.json")

    assert response.status_code == 200
    spec = response.json()
    assert spec["info"]["title"] == "Recop"
    assert "/health" in spec["paths"]
