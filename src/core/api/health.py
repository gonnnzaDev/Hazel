from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from core.api.deps import SessionDep, SettingsDep

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", summary="Process status")
async def health(settings: SettingsDep) -> dict[str, object]:
    return {
        "status": "ok",
        "service": "recop-node",
        "version": "0.1.0",
        "environment": settings.env,
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.get("/ready", summary="Ready to receive traffic")
async def readiness(response: Response, session: SessionDep) -> dict[str, object]:
    checks: dict[str, object] = {}
    ready = True

    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
        ready = False

    checks["kafka"] = "not_wired"

    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if ready else "unavailable", "checks": checks}
