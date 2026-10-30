from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_CONTENT_TYPE = "application/problem+json"


class DomainError(Exception):
    status_code: int = 400
    code: str = "domain_error"
    title: str = "Domain error"

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
    title = "Resource not found"


class ConflictError(DomainError):
    status_code = 409
    code = "conflict"
    title = "Conflict"


class ValidationDomainError(DomainError):
    status_code = 422
    code = "domain_validation_error"
    title = "Invalid data"


class AuthenticationError(DomainError):
    status_code = 401
    code = "unauthenticated"
    title = "Unauthenticated"


class PermissionDeniedError(DomainError):
    status_code = 403
    code = "forbidden"
    title = "Permission denied"


class ServerInactiveError(DomainError):
    status_code = 409
    code = "server_inactive"
    title = "Server inactive"


class InviteNotFoundError(DomainError):
    status_code = 404
    code = "invite_not_found"
    title = "Invite not found"


class InviteExpiredError(DomainError):
    status_code = 410
    code = "invite_expired"
    title = "Invite expired"


class MessageTooLargeError(DomainError):
    status_code = 413
    code = "message_too_large"
    title = "Message too large"


class RateLimitError(DomainError):
    status_code = 429
    code = "rate_limited"
    title = "Rate limited"


class InviteNotFoundError(DomainError):
    status_code = 404
    code = "invite_not_found"
    title = "Invite not found"


class InviteExpiredError(DomainError):
    status_code = 410
    code = "invite_expired"
    title = "Invite expired"


class AttachmentTooLargeError(DomainError):
    status_code = 413
    code = "attachment_too_large"
    title = "Attachment too large"


def problem(
    *,
    status: int,
    title: str,
    detail: str,
    code: str,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {
        "type": f"https://hazel.dev/errors/{code}",
        "title": title,
        "status": status,
        "code": code,
        "detail": detail,
    }
    if extra:
        payload.update(extra)
    return JSONResponse(status_code=status, content=payload, media_type=PROBLEM_CONTENT_TYPE)


def register_exception_handlers(app: FastAPI) -> None:

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
            title="Invalid data",
            detail="The request body does not match the expected contract.",
            code="request_validation_error",
            extra={"errors": exc.errors()},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem(
            status=exc.status_code,
            title="HTTP error",
            detail=str(exc.detail),
            code=f"http_{exc.status_code}",
        )

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
        return problem(
            status=500,
            title="Internal error",
            detail="An unexpected error occurred. Please try again later.",
            code="internal_error",
        )
