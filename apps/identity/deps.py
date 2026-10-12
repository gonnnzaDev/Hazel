"""Dependencias de autenticación.

Acá es donde HTTP se encuentra con la identidad: se saca el token del request y
se resuelve a un miembro. Es la única parte de esta app que sabe de FastAPI.

## Por qué hay dos dependencias en vez de una

El token se guarda **hasheado**, así que no se puede recuperar de la base. Pero
`refresh` y `logout` necesitan el token crudo: lo que quieren es revocar *este*
token, no todos.

Podría haber una dependencia que devuelva `(miembro, token)`. El problema es que
FastAPI construye un modelo Pydantic del tipo de retorno para resolverlo, y no
puede generar un schema a partir de un objeto que contiene un modelo de
SQLAlchemy.

Por eso están separadas:

- `CurrentMember` resuelve y valida el token contra la base. Caro, se cachea por request.
- `RawToken` solo lo saca del header. Barato, sin tocar la base.

Un endpoint que necesita ambos declara los dos.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Query, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from apps.identity.models import Member
from apps.identity.services import authenticate
from core.api.deps import db_session


def bearer_token(header: str | None) -> str:
    """Saca el token de un header `Authorization: Bearer <token>`."""
    if not header:
        return ""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def query_token(token: str | None) -> str:
    """Token del query string, que es como llega en el handshake del WebSocket."""
    return (token or "").strip()


async def member_from_header(
    session: Annotated[AsyncSession, Depends(db_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> Member:
    """Autentica por header. Para la API HTTP."""
    return await authenticate(session, bearer_token(authorization))


async def member_from_query(
    session: Annotated[AsyncSession, Depends(db_session)],
    token: Annotated[str | None, Query()] = None,
) -> Member:
    """Autentica por query string. Para el handshake del WebSocket.

    El token va por query string porque ni el navegador ni varios clientes
    mobile permiten headers custom en el handshake. No es ideal —los query
    strings se quedan en los logs del proxy— pero es lo que hay. La alternativa
    es un subprotocolo de WebSocket, que no lo soporta todo el mundo.
    """
    return await authenticate(session, query_token(token))


async def raw_token_from_header(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    """El token crudo del header, sin tocar la base.

    Para revocar *este* token concreto, que no se puede recuperar del hash.
    """
    return bearer_token(authorization)


CurrentMember = Annotated[Member, Depends(member_from_header)]
"""El miembro que hace el request. Falla con 401 si el token no es válido."""

CurrentMemberWs = Annotated[Member, Depends(member_from_query)]
"""Igual, pero por query string. Para WebSockets."""

RawToken = Annotated[str, Depends(raw_token_from_header)]
"""El token crudo del request. Solo para revocar."""

SessionDep = Annotated[AsyncSession, Depends(db_session)]
"""Sesión de base, para los endpoints que no necesitan autenticación."""


async def websocket_auth(websocket: WebSocket) -> str:
    """Token del handshake de un WebSocket.

    Se usa como dependencia del router: si el token es inválido hay que fallar
    **antes** del handshake, porque después ya no se puede responder con un JSON
    de error. FastAPI convierte el fallo en un cierre con código 1008 (policy
    violation), que es lo correcto para WebSocket.
    """
    return query_token(websocket.query_params.get("token"))
