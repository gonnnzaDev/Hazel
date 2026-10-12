"""Servicios del nodo: los grupos y sus procesos.

Acá vive el nexo entre la base y el supervisor de procesos. La regla es una:

> El estado de un grupo en la base y el estado de su proceso tienen que
> coincidir.

Si divergen, el dueño ve algo que no es cierto. Si el grupo dice `active` y el
proceso murió, comparte un puerto donde no entra nadie. Si dice `inactive` y el
proceso vive, un puerto queda ocupado sin que nadie lo sepa.

Por eso **la base se escribe después de que el proceso levantó**. Si el proceso
no arrancó, el grupo queda inactivo y no se anuncia como disponible.
"""

from __future__ import annotations

import logging
from typing import Any

from apps.common.types import RecordId, utcnow
from apps.identity.roles import Role
from apps.servers import services as servers_services
from apps.servers.models import Server
from apps.servers.schemas import ServerCreate
from apps.servers.services import get_server, list_servers, normalize_slug, slug_taken
from apps.servers.states import ServerStatus
from core.api.errors import ConflictError, PermissionDeniedError, ValidationDomainError
from core.config import get_settings
from core.network import local_addresses
from core.ports import next_available_port

logger = logging.getLogger(__name__)

#: Cuánto se espera a que un grupo levante antes de darlo por fallido.
GROUP_READY_TIMEOUT_SECONDS = 20.0


def supervisor_from(request: Any) -> Any:
    """Saca el supervisor del estado de la app.

    Vive en `app.state` porque pertenece al ciclo de vida del proceso, no a la
    request. Un proceso de grupo no lo tiene: por eso elevar o apagar un grupo
    desde el proceso equivocado da un error claro en vez de un `None` críptico.

    Se lee de `request.app.state` y **no** de `request.state`: en la versión de
    Starlette que usa el proyecto, `request.state` es un `State` propio que no
    delega en `app.state`. Escribiendo `request.state.supervisor` el atributo
    queda invisible para el resto de la app y el endpoint responde siempre
    "este proceso no es el nodo".
    """
    supervisor = getattr(getattr(request.app, "state", None), "supervisor", None)
    if supervisor is None:
        raise ConflictError(
            "Este proceso no es el nodo, así que no puede manejar grupos. "
            "Los grupos se manejan desde el proceso del nodo.",
            code="not_the_node",
        )
    return supervisor


# ──────────────────────────────────────────────────────────────────────────────
# Puertos
# ──────────────────────────────────────────────────────────────────────────────


async def _all_servers(session: Any) -> list[Server]:
    """Todos los grupos registrados en este nodo."""
    servers, _ = await list_servers(session, limit=1000, offset=0)
    return servers


def _reserved_ports(servers: list[Server]) -> set[int]:
    """Puertos que ya tienen un grupo registrado.

    Incluye los inactivos: un grupo apagado conserva su puerto para cuando lo
    vuelvan a encender, así que lo sigue reservando. Si no, dos grupos podrían
    apuntar al mismo puerto y el segundo no levantaría nunca.
    """
    return {s.bind_port for s in servers if s.bind_port is not None}


async def _allocate_port(
    session: Any,
    supervisor: Any,
    *,
    preferred: int | None = None,
    ignoring: set[RecordId] | None = None,
) -> int | None:
    """Un puerto libre para un grupo.

    Se combinan las dos fuentes de conflicto: los puertos registrados en la base
    (para que dos grupos del mismo nodo no choquen) y los que ya tienen proceso
    vivo (por si la base quedó desfasada y alguien spunkeó un proceso a mano).

    El supervisor se pasa explícitamente y no se busca en la sesión a propósito:
    los services reciben lo que necesitan como argumento, no lo van a buscar de
    la.request. Así siguen siendo testables sin FastAPI.
    """
    servers = await _all_servers(session)
    skip = ignoring or set()
    taken = {s.bind_port for s in servers if s.bind_port is not None and s.id not in skip}
    taken |= supervisor.used_ports()

    return next_available_port(get_settings(), preferred=preferred, taken=taken)


# ──────────────────────────────────────────────────────────────────────────────
# Desplegar, encender, apagar, borrar
# ──────────────────────────────────────────────────────────────────────────────


async def create_group(session: Any, supervisor: Any, payload: ServerCreate) -> Server:
    """Despliega un grupo: levanta su proceso y lo deja funcionando.

    Desplegar **implica encender**, que es la promesa del producto: si el dueño
    pidió desplegar, el puerto queda abierto y se puede compartir.

    El orden importa. Primero se levanta el proceso y se espera a que responda,
    recién ahí el grupo queda `active` en la base. Al revés habría una ventana
    en la que el grupo dice que está activo y su puerto todavía no escucha.
    """
    slug = normalize_slug(payload.slug)
    if not slug:
        raise ValidationDomainError(
            "El identificador del grupo no puede quedar vacío.",
            code="invalid_slug",
        )

    if await slug_taken(session, slug):
        raise ConflictError(
            f"El identificador '{slug}' ya está en uso.",
            code="slug_taken",
            extra={"slug": slug},
        )

    port = await _allocate_port(session, supervisor)
    if port is None:
        raise ConflictError(
            "No quedan puertos libres para un grupo más. "
            "Subí RECOP_GROUP_PORT_END en el .env si necesitás más.",
            code="no_free_port",
        )

    # La fila la arma `apps.servers.services.create_server`, que ya tiene las
    # reglas de la tabla (slug único, canal por defecto, canales iniciales).
    # Acá solo se le pasa el puerto que se le asignó. Duplicar esa construcción
    # sería tener dos lugares donde el modelo puede quedar mal armado, y el
    # primero que se olvide de un campo rompe el alta sin que ningún test lo vea.
    server = await servers_services.create_server(session, payload, port=port)

    await supervisor.spawn(server.id, port)
    ready = await supervisor.wait_ready(server.id, timeout_seconds=GROUP_READY_TIMEOUT_SECONDS)

    server.status = ServerStatus.ACTIVE if ready else ServerStatus.INACTIVE
    server.last_heartbeat_at = utcnow() if ready else None
    await session.flush()

    if ready:
        logger.info("grupo %s desplegado y escuchando en el puerto %s", slug, port)
    else:
        logger.error(
            "el grupo %s quedó registrado pero su proceso no levantó. "
            "Queda inactivo: se puede volver a encender desde el panel.",
            slug,
        )

    return server


async def start_group(session: Any, supervisor: Any, server_id: RecordId) -> Server:
    """Enciende un grupo apagado.

    Encender uno que ya está encendido es un no-op, no un error: el dueño pone
    "encender" en su flujo sin consultar el estado previo.
    """
    server = await get_server(session, server_id)

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "Este grupo fue eliminado y no se puede volver a encender.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if supervisor.is_running(server_id):
        server.status = ServerStatus.ACTIVE
        server.last_heartbeat_at = utcnow()
        await session.flush()
        return server

    port = await _allocate_port(
        session, supervisor, preferred=server.bind_port, ignoring={server.id}
    )
    if port is None:
        raise ConflictError(
            "No queda ningún puerto libre para encender este grupo.",
            code="no_free_port",
        )

    await supervisor.spawn(server_id, port)
    ready = await supervisor.wait_ready(server_id, timeout_seconds=GROUP_READY_TIMEOUT_SECONDS)

    server.bind_port = port
    server.status = ServerStatus.ACTIVE if ready else ServerStatus.INACTIVE
    server.last_heartbeat_at = utcnow() if ready else None
    await session.flush()

    logger.info("grupo %s encendido en el puerto %s", server.slug, port)
    return server


async def stop_group(session: Any, supervisor: Any, server_id: RecordId) -> Server:
    """Apaga un grupo: baja el proceso y cierra el puerto.

    **No borra nada.** Canales, miembros y mensajes quedan intactos y el grupo
    vuelve a levantar con todo dentro. Es la promesa central del producto: si
    apagás tu grupo, lo encontrás igual cuando lo volvés a encender.

    El puerto queda reservado: es el mismo que va a usar cuando lo reencendáis.
    """
    server = await get_server(session, server_id)

    await supervisor.terminate(server_id)

    server.status = ServerStatus.INACTIVE
    await session.flush()

    logger.info("grupo %s apagado; sus datos siguen intactos", server.slug)
    return server


async def delete_group(session: Any, supervisor: Any, server_id: RecordId) -> None:
    """Elimina un grupo de forma permanente.

    La única operación destructiva. Primero baja el proceso: si el grupo se
    borra con el proceso vivo, el puerto queda ocupado hasta que el nodo se
    reinicie, y el siguiente grupo que lo quiera no lo puede tomar.
    """
    server = await get_server(session, server_id)

    await supervisor.terminate(server_id)
    await session.delete(server)
    await session.flush()

    logger.info("grupo %s eliminado", server.slug)


# ──────────────────────────────────────────────────────────────────────────────
# Estado
# ──────────────────────────────────────────────────────────────────────────────


def process_state(supervisor: Any, server: Server) -> dict[str, object]:
    """El estado real del proceso de un grupo, para el panel.

    Va aparte del `status` de la base a propósito: uno es lo que el dueño pidió,
    el otro es lo que está pasando. Mostrar los dos por separado es la única
    forma de que vea un grupo que se murió sin que el panel le diga que está bien.
    """
    group = supervisor.status(server.id)

    if group is None:
        return {"running": False, "pid": None, "uptime_seconds": None, "exit_code": None}

    return {
        "running": group.is_running,
        "pid": group.pid,
        "uptime_seconds": round(group.uptime_seconds, 1) if group.is_running else None,
        "exit_code": group.returncode,
    }


def group_address(server: Server) -> dict[str, object]:
    """La dirección que el dueño comparte para entrar a este grupo.

    A diferencia del nodo, acá el puerto es el del grupo y no hace falta elegir
    interfaz: es un único puerto y ya está asignado.
    """
    addresses = local_addresses()
    recommended = addresses[0].host if addresses else None

    return {
        "slug": server.slug,
        "port": server.bind_port,
        # El grupo se alcanza por el puerto del nodo (0.0.0.0 o la IP que el
        # dueño tenga configurada). No es una columna del grupo: es la
        # configuración del proceso del nodo.
        "host": get_settings().host,
        "is_reachable": server.status.accepts_traffic,
        "recommended_host": recommended,
        "address": f"{recommended}:{server.bind_port}" if recommended else None,
    }


def ensure_can_manage(actor_role: int, *, deleting: bool = False) -> None:
    """Solo el dueño administra los grupos del nodo.

    En Recop el dueño del nodo es el dueño de sus grupos: él los despliega
    en su máquina, no tiene sentido que otro pueda apagarlos o borrarlos.
    """
    if actor_role < Role.ADMIN:
        raise PermissionDeniedError(
            "Necesitás ser administrador para manejar los grupos del nodo.",
            code="not_admin",
        )
    if deleting and actor_role is not Role.OWNER:
        raise PermissionDeniedError(
            "Solo el dueño del nodo puede eliminar un grupo.",
            code="owner_required",
        )


__all__ = [
    "create_group",
    "delete_group",
    "ensure_can_manage",
    "group_address",
    "process_state",
    "start_group",
    "stop_group",
    "supervisor_from",
]


# ──────────────────────────────────────────────────────────────────────────────
# Ficha del nodo
# ──────────────────────────────────────────────────────────────────────────────


def node_info() -> dict[str, object]:
    """Qué es este proceso.

    Lo primero que consulta un cliente para saber a qué se conectó.
    """
    from core import __version__

    settings = get_settings()
    return {
        "service": "recop-node",
        "version": __version__,
        "environment": settings.env,
        "bind_host": settings.host,
        "bind_port": settings.port,
        # Si estamos respondiendo, estamos escuchando. No hay otro estado
        # observable desde adentro del proceso.
        "is_listening": True,
        "kafka_topic_prefix": settings.kafka_topic_prefix,
    }


def node_address() -> dict[str, object]:
    """La dirección del proceso del nodo: su puerto y las IPs de la máquina.

    El nodo escucha en `0.0.0.0`, que no es una dirección a la que se pueda
    conectar. Acá se resuelve cuáles de las interfaces sí lo son.

    Los grupos tienen puertos propios; esta dirección es la del panel del dueño.
    """
    settings = get_settings()
    addresses = local_addresses()

    return {
        "port": settings.port,
        "bind_host": settings.host,
        "is_wildcard": settings.bind_host_is_wildcard,
        "candidates": addresses,
        "recommended": addresses[0].host if addresses else None,
        "group_port_range": {
            "first": settings.port + 1,
            "last": settings.group_port_end,
        },
    }
