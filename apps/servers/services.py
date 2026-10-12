"""Lógica de negocio del ciclo de vida del servidor.

Este módulo **no importa FastAPI**. Habla en excepciones de dominio
(`core/api/errors.py`), que la capa API traduce a respuestas HTTP. Eso permite
testearlo sin levantar la app y reutilizarlo tal cual desde un worker o un CLI.

Reglas que implementa:

1. Desplegar un servidor deja el puerto abierto: crear implica activar.
2. Desactivar **no** borra nada. Canales, miembros y mensajes quedan intactos y
   el servidor vuelve a levantar igual. Es el corazón del producto.
3. Si el proceso se cae, el servidor queda `INACTIVE`, nunca destruido.
4. Activar un servidor ya activo es un no-op, no un error.
5. Borrar es la única operación destructiva, y es explícita.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.common.types import RecordId, new_id, utcnow
from apps.servers.models import Channel, ChannelKind, Message, Server
from apps.servers.schemas import ChannelCreate, ServerCreate, ServerUpdate
from apps.servers.states import ServerStatus, can_transition
from core.api.errors import (
    ConflictError,
    NotFoundError,
    ServerInactiveError,
    ValidationDomainError,
)

logger = logging.getLogger(__name__)

DEFAULT_CHANNEL_NAME = "general"

MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 64


# ──────────────────────────────────────────────────────────────────────────────
# Normalización
# ──────────────────────────────────────────────────────────────────────────────


#: Direcciones comodín: el proceso escucha en todas las interfaces.
#:
#: Un nodo autohospedado necesita una de estas para ser alcanzable por la red,
#: pero no sirven como dirección compartible: `0.0.0.0` es un comodín, no un
#: destino. Ver `ServerAddress.host_is_wildcard`.
WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104


def is_wildcard_host(host: str) -> bool:
    """Si el host es una dirección comodín en vez de una IP concreta."""
    return host.strip() in WILDCARD_HOSTS


def normalize_slug(raw: str) -> str:
    """Convierte un nombre de servidor en un identificador compartible.

    `"Casa de Luis"` → `"casa-de-luis"`.
    """
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", without_accents).strip("-")


async def slug_taken(session: AsyncSession, slug: str, *, exclude: RecordId | None = None) -> bool:
    """Si el slug ya está en uso por otro servidor."""
    stmt = select(func.count()).select_from(Server).where(Server.slug == slug)
    if exclude is not None:
        stmt = stmt.where(Server.id != exclude)
    return (await session.execute(stmt)).scalar_one() > 0


# ──────────────────────────────────────────────────────────────────────────────
# Lecturas
# ──────────────────────────────────────────────────────────────────────────────


async def get_server(session: AsyncSession, server_id: RecordId) -> Server:
    """Carga un servidor con sus canales. Lanza `NotFoundError` si no existe."""
    stmt = select(Server).options(selectinload(Server.channels)).where(Server.id == server_id)
    server = (await session.execute(stmt)).scalar_one_or_none()

    if server is None:
        raise NotFoundError(
            "El servidor no existe.",
            code="server_not_found",
            extra={"server_id": str(server_id)},
        )
    return server


async def list_servers(
    session: AsyncSession, *, limit: int, offset: int
) -> tuple[list[Server], int]:
    """Listado paginado, del más reciente al más viejo.

    Los ids son UUID v7, así que `ORDER BY id DESC` ya es un orden por fecha de
    creación y no hace falta un índice extra.
    """
    total = (await session.execute(select(func.count()).select_from(Server))).scalar_one()

    stmt = (
        select(Server)
        .options(selectinload(Server.channels))
        .order_by(Server.id.desc())
        .limit(limit)
        .offset(offset)
    )
    servers = (await session.execute(stmt)).scalars().all()
    return list(servers), int(total)


async def resolve_by_slug(session: AsyncSession, slug: str) -> Server:
    """Busca un servidor por su identificador, que es lo que se comparte."""
    stmt = select(Server).options(selectinload(Server.channels)).where(Server.slug == slug)
    server = (await session.execute(stmt)).scalar_one_or_none()

    if server is None:
        raise NotFoundError(
            f"No hay ningún servidor con el identificador '{slug}'.",
            code="server_not_found_by_slug",
            extra={"slug": slug},
        )
    return server


# ──────────────────────────────────────────────────────────────────────────────
# Escrituras
# ──────────────────────────────────────────────────────────────────────────────


def _build_channels(payload_channels: list[ChannelCreate]) -> list[Channel]:
    """Construye los canales iniciales a partir del payload."""
    channels: list[Channel] = []
    for raw in payload_channels:
        try:
            kind = ChannelKind(raw.kind)
        except ValueError:
            raise ValidationDomainError(
                f"'{raw.kind}' no es un tipo de canal válido.",
                code="invalid_channel_kind",
                extra={"allowed": [k.value for k in ChannelKind]},
            ) from None
        channels.append(
            Channel(
                id=new_id(),
                name=raw.name.strip(),
                kind=kind,
                topic=raw.topic,
                position=raw.position,
                is_default=raw.is_default,
            )
        )
    return channels


def _ensure_default_channel(server: Server) -> None:
    """Garantiza que el servidor tenga exactamente un canal por defecto."""
    if not server.channels:
        server.channels.append(
            Channel(
                id=new_id(),
                name=DEFAULT_CHANNEL_NAME,
                kind=ChannelKind.TEXT,
                is_default=True,
            )
        )
        return

    defaults = [c for c in server.channels if c.is_default]
    if len(defaults) > 1:
        raise ValidationDomainError(
            "Un servidor no puede tener más de un canal por defecto.",
            code="multiple_default_channels",
        )
    if not defaults:
        # El primero por posición asume el rol de canal de entrada.
        server.channels[0].is_default = True


async def create_server(session: AsyncSession, payload: ServerCreate, *, port: int) -> Server:
    """Registra un grupo nuevo en la base.

    El puerto lo decide el caller, no esta función: asignarlo es trabajo del
    proceso del nodo, que es el único que sabe qué puertos están ocupados en la
    máquina. Ver `apps.node.services.create_group`, que es la entrada de verdad
    para desplegar un grupo: asigna el puerto, levanta el proceso y recién
    después llama a esta.

    El grupo nace `CREATING`: el estado final lo pone quien levantó el proceso,
    porque hasta que el proceso responde no se sabe si el grupo está-serving o
    no. Marcarlo `ACTIVE` antes sería mentir.
    """
    slug = normalize_slug(payload.slug)
    if len(slug) < MIN_SLUG_LENGTH or len(slug) > MAX_SLUG_LENGTH:
        raise ValidationDomainError(
            "El identificador del servidor debe tener entre "
            f"{MIN_SLUG_LENGTH} y {MAX_SLUG_LENGTH} caracteres.",
            code="invalid_slug",
            extra={"slug": payload.slug},
        )

    if await slug_taken(session, slug):
        raise ConflictError(
            f"El identificador '{slug}' ya está en uso.",
            code="slug_taken",
            extra={"slug": slug},
        )

    server = Server(
        id=new_id(),
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
        status=ServerStatus.CREATING,
        bind_port=port,
        max_members=payload.max_members,
        channels=_build_channels(payload.channels),
    )

    _ensure_default_channel(server)
    session.add(server)
    await session.flush()

    logger.info("servidor registrado slug=%s puerto=%s", server.slug, port)
    return server


async def update_server(session: AsyncSession, server: Server, payload: ServerUpdate) -> Server:
    """Aplica cambios parciales a la configuración del servidor."""
    changes = payload.model_dump(exclude_unset=True)

    for field, value in changes.items():
        setattr(server, field, value)

    await session.flush()
    return server


async def activate_server(session: AsyncSession, server: Server) -> Server:
    """Activa el servidor y abre su puerto.

    Activar uno ya activo es un no-op, no un error: el dueño puede poner "encender
    el servidor" en su flujo sin consultar el estado previo.
    """
    if server.status is ServerStatus.ACTIVE:
        server.last_heartbeat_at = utcnow()
        await session.flush()
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "Este servidor fue eliminado y no se puede volver a activar.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.ACTIVE):
        raise ConflictError(
            f"No se puede activar un servidor en estado '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.ACTIVE.value},
        )

    server.status = ServerStatus.ACTIVE
    server.last_heartbeat_at = utcnow()
    await session.flush()

    logger.info("servidor activado slug=%s", server.slug)
    return server


async def deactivate_server(session: AsyncSession, server: Server) -> Server:
    """Desactiva el servidor y cierra su puerto.

    **No borra nada.** Canales, miembros y mensajes quedan intactos y el
    servidor vuelve a levantar con todo dentro. Es el comportamiento que el
    producto necesita: si el dueño apaga su servidor, tiene que poder volver a
    encenderlo y encontrarlo como estaba.
    """
    if server.status is ServerStatus.INACTIVE:
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "Este servidor ya fue eliminado.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.INACTIVE):
        raise ConflictError(
            f"No se puede desactivar un servidor en estado '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.INACTIVE.value},
        )

    server.status = ServerStatus.INACTIVE
    await session.flush()

    logger.info("servidor desactivado slug=%s", server.slug)
    return server


async def heartbeat(session: AsyncSession, server: Server, *, at: datetime | None = None) -> Server:
    """Registra que el proceso del servidor sigue vivo.

    Permite distinguir un servidor que el dueño apagó a propósito de uno que se
    cayó. La diferencia importa: lo primero es una decisión, lo segundo un
    incidente.
    """
    server.last_heartbeat_at = at or utcnow()
    await session.flush()
    return server


async def delete_server(session: AsyncSession, server: Server) -> None:
    """Elimina el servidor de forma permanente.

    Es la única operación destructiva del ciclo de vida, y la única que el dueño
    tiene que pedir explícitamente. Los canales se van por cascada.
    """
    if server.status.is_terminal:
        raise ConflictError(
            "Este servidor ya fue eliminado.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.DELETED):
        raise ConflictError(
            f"No se puede eliminar un servidor en estado '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.DELETED.value},
        )

    slug = server.slug
    await session.delete(server)
    logger.info("servidor eliminado slug=%s", slug)


async def mark_all_inactive(session: AsyncSession) -> int:
    """Pasa a `INACTIVE` todo servidor que figure `ACTIVE` en la base.

    Se llama al **arrancar** el nodo. Cubre exactamente el caso que pediste: si el
    proceso se cerró de cualquier manera (crash, cierre de la PC, kill), al
    volver a levantar el nodo ningún servidor queda marcado como activo cuando
    en realidad no lo está.

    Sin esto, un servidor que se cayó seguiría figurando `ACTIVE` en la base y
    el sistema creería que su puerto está abierto.

    Devuelve cuántos servidores quedaron marcados.
    """
    result = await session.execute(
        update(Server)
        .where(Server.status.in_([ServerStatus.CREATING, ServerStatus.ACTIVE]))
        .values(status=ServerStatus.INACTIVE, updated_at=utcnow())
        .returning(Server.id)
    )
    count = len(result.all())
    if count:
        logger.info(
            "%d servidor(es) quedaron inactivos tras el arranque del nodo. "
            "Ninguno escucha hasta que su dueño los vuelva a activar.",
            count,
        )
    return count


# ──────────────────────────────────────────────────────────────────────────────
# Guardas
# ──────────────────────────────────────────────────────────────────────────────


def ensure_active(server: Server) -> None:
    """Falla si el servidor no está listo para atender tráfico.

    Se usa en el chat: escribir en un servidor apagado tiene que devolver un
    error claro, no un fallo de conexión críptico que el cliente no sabe leer.
    """
    if not server.status.accepts_traffic:
        raise ServerInactiveError(
            f"El servidor está {server.status.value}. No acepta conexiones hasta "
            f"que su dueño lo vuelva a activar.",
            extra={"server_id": str(server.id), "status": server.status.value},
        )


async def create_message(
    session: AsyncSession, channel_id: RecordId, author_nickname: str, content: str
) -> Message:
    """Registra un mensaje de texto en un canal.

    El mensaje queda asociado al canal y se ordena por `created_at`.
    No hay validación de permisos: cualquier cliente conectado al servidor
    puede enviar mensajes (la regla de permisos la aplica el cliente).
    """
    message = Message(
        id=new_id(),
        channel_id=channel_id,
        author_nickname=author_nickname,
        content=content,
    )
    session.add(message)
    await session.flush()
    logger.info("mensaje registrado canal=%s nick=%s", channel_id, author_nickname)
    return message


async def list_messages(
    session: AsyncSession, channel_id: RecordId, limit: int = 50, offset: int = 0
) -> tuple[list[Message], int]:
    """Devuelve el historial de mensajes de un canal, más recientes primero."""
    total = (
        await session.execute(
            select(func.count()).select_from(Message).where(Message.channel_id == channel_id)
        )
    ).scalar_one()
    stmt = (
        select(Message)
        .where(Message.channel_id == channel_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    messages = (await session.execute(stmt)).scalars().all()
    return list(messages), int(total)


# ──────────────────────────────────────────────────────────────────────────────
# Guardas
# ──────────────────────────────────────────────────────────────────────────────
