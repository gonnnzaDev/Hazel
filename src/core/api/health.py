"""Node health and diagnostics."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from core.api.deps import SessionDep, SettingsDep

router = APIRouter(prefix="/health", tags=["salud"])


@router.get("", summary="Estado del proceso")
async def health(settings: SettingsDep) -> dict[str, object]:
    """Liveness; touches no dependencies."""
    return {
        "status": "ok",
        "service": "recop-node",
        "version": "0.1.0",
        "environment": settings.env,
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.get("/ready", summary="Listo para recibir tráfico")
async def readiness(response: Response, session: SessionDep) -> dict[str, object]:
    """Readiness with all dependency checks; 503 when unservable."""
    checks: dict[str, object] = {}
    ready = True

    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
        ready = False

    # Kafka not wired yet; reported explicitly instead of omitted.
    checks["kafka"] = "not_wired"

    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if ready else "unavailable", "checks": checks}
