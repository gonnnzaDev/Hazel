from __future__ import annotations

"""Token introspection: middleware validates token and returns the member."""

from typing import Annotated

from fastapi import Depends, Header, Query, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.deps import db_session
from identity.model import Member
from identity.service import authenticate


def bearer_token(header: str | None) -> str:
    if not header:
        return ""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def query_token(token: str | None) -> str:
    return (token or "").strip()


async def member_from_header(
    session: Annotated[AsyncSession, Depends(db_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> Member:
    return await authenticate(session, bearer_token(authorization))


async def member_from_query(
    session: Annotated[AsyncSession, Depends(db_session)],
    token: Annotated[str | None, Query()] = None,
) -> Member:
    return await authenticate(session, query_token(token))


async def raw_token_from_header(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    return bearer_token(authorization)


CurrentMember = Annotated[Member, Depends(member_from_header)]

CurrentMemberWs = Annotated[Member, Depends(member_from_query)]

RawToken = Annotated[str, Depends(raw_token_from_header)]

SessionDep = Annotated[AsyncSession, Depends(db_session)]


async def websocket_auth(websocket: WebSocket) -> str:
    return query_token(websocket.query_params.get("token"))
