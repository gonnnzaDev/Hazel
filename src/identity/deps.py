"""Auth dependencies: HTTP token to member resolution.

Two deps on purpose: CurrentMember (cached DB auth) and RawToken (header-only for
revocation); a tuple return breaks FastAPI schema generation.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Query, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.deps import db_session
from identity.model import Member
from identity.service import authenticate


def bearer_token(header: str | None) -> str:
    """Extract token from Authorization: Bearer header."""
    if not header:
        return ""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def query_token(token: str | None) -> str:
    """Extract token from query string (WebSocket handshake)."""
    return (token or "").strip()


async def member_from_header(
    session: Annotated[AsyncSession, Depends(db_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> Member:
    """Authenticate via header; for HTTP API."""
    return await authenticate(session, bearer_token(authorization))


async def member_from_query(
    session: Annotated[AsyncSession, Depends(db_session)],
    token: Annotated[str | None, Query()] = None,
) -> Member:
    """Authenticate via query string; handshake headers are unsupported by browsers."""
    return await authenticate(session, query_token(token))


async def raw_token_from_header(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    """Raw header token without DB hit; for revoking this token."""
    return bearer_token(authorization)


CurrentMember = Annotated[Member, Depends(member_from_header)]
"""Requesting member; 401 on invalid token."""

CurrentMemberWs = Annotated[Member, Depends(member_from_query)]
"""Same via query string; for WebSockets."""

RawToken = Annotated[str, Depends(raw_token_from_header)]
"""Raw request token; revocation only."""

SessionDep = Annotated[AsyncSession, Depends(db_session)]
"""DB session for unauthenticated endpoints."""


async def websocket_auth(websocket: WebSocket) -> str:
    """WebSocket handshake token; must fail before handshake (1008 on invalid)."""
    return query_token(websocket.query_params.get("token"))
