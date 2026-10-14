"""Domain errors mapped to RFC 9457 problem+json.

Services raise without knowing HTTP; handlers translate for all clients.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_CONTENT_TYPE = "application/problem+json"


class DomainError(Exception):
    """Base for business errors; API layer renders it."""

    status_code: int = 400
    code: str = "domain_error"
    title: str = "Error de dominio"

    def __init__(
        self,
        detail: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.extra = extra or {}


class NotFoundError(DomainError):
    status_code = 404
    code = "not_found"
    title = "Recurso no encontrado"


class ConflictError(DomainError):
    """Current-state conflict (e.g. duplicate name, already active)."""

    status_code = 409
    code = "conflict"
    title = "Conflicto"


class ValidationDomainError(DomainError):
    """Syntactically valid data violating domain rules."""

    status_code = 422
    code = "domain_validation_error"
    title = "Datos inválidos"


class AuthenticationError(DomainError):
    status_code = 401
    code = "unauthenticated"
    title = "No autenticado"


class PermissionDeniedError(DomainError):
    status_code = 403
    code = "forbidden"
    title = "Sin permiso"


class ServerInactiveError(DomainError):
    """Server exists but is stopped; reactivate to accept connections."""

    status_code = 409
    code = "server_inactive"
    title = "Servidor inactivo"


def problem(
    *,
    status: int,
    title: str,
    detail: str,
    code: str,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    """Build an application/problem+json response."""
    payload: dict[str, Any] = {
        "type": f"https://recop.dev/errors/{code}",
        "title": title,
        "status": status,
        "code": code,
        "detail": detail,
    }
    if extra:
        payload.update(extra)
    return JSONResponse(status_code=status, content=payload, media_type=PROBLEM_CONTENT_TYPE)


def register_exception_handlers(app: FastAPI) -> None:
    """Register handlers mapping exceptions to consistent responses."""

    @app.exception_handler(DomainError)
    async def _domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
        return problem(
            status=exc.status_code,
            title=exc.title,
            detail=exc.detail,
            code=exc.code,
            extra=exc.extra,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return problem(
            status=422,
            title="Datos inválidos",
            detail="El cuerpo de la petición no cumple el contrato esperado.",
            code="request_validation_error",
            extra={"errors": exc.errors()},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem(
            status=exc.status_code,
            title="Error HTTP",
            detail=str(exc.detail),
            code=f"http_{exc.status_code}",
        )

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
        # Never leak internals; details stay in server logs.
        return problem(
            status=500,
            title="Error interno",
            detail="Ocurrió un error inesperado. Intentá de nuevo más tarde.",
            code="internal_error",
        )
