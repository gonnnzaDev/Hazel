from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Depends, Header

from core.api.deps import SettingsDep
from core.api.errors import AuthenticationError, DomainError


class AdminTokenNotConfiguredError(DomainError):
    status_code = 503
    code = "admin_token_not_configured"
    title = "Admin token not configured"


def _bearer_token(header: str | None) -> str:
    if not header:
        return ""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


async def require_admin_token(
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    configured = settings.admin_token.strip()
    if not configured:
        raise AdminTokenNotConfiguredError(
            "HAZEL_ADMIN_TOKEN is not configured. Set it in your .env to manage servers.",
        )

    provided = _bearer_token(authorization)
    if not provided or not secrets.compare_digest(provided, configured):
        raise AuthenticationError(
            "A valid node administration token is required.",
            code="invalid_admin_token",
        )


AdminAuth = Annotated[None, Depends(require_admin_token)]
