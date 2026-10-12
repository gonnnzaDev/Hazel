"""Endpoints de salud y diagnóstico del nodo."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from core.api.deps import SessionDep, SettingsDep

router = APIRouter(prefix="/health", tags=["salud"])


@router.get("", summary="Estado del proceso")
async def health(settings: SettingsDep) -> dict[str, object]:
    """Liveness. No toca dependencias: si responde, el proceso está vivo."""
    return {
        "status": "ok",
        "service": "recop-node",
        "version": "0.1.0",
        "environment": settings.env,
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.get("/ready", summary="Listo para recibir tráfico")
async def readiness(response: Response, session: SessionDep) -> dict[str, object]:
    """Readiness. Verifica que las dependencias del nodo respondan.

    Devuelve 503 si el nodo no puede servir tráfico, para que un orquestador
    (o el propio reinicio del proceso) lo detecte.

    Se reportan **todas** las dependencias aunque una falle: así el cliente ve
    el panorama completo y no solo el primer error.
    """
    checks: dict[str, object] = {}
    ready = True

    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
        ready = False

    # Kafka entra con la app de chat; por ahora se reporta explícitamente
    # como no conectado en vez de omitirlo.
    checks["kafka"] = "not_wired"

    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if ready else "unavailable", "checks": checks}
