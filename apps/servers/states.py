"""Estados posibles de un servidor.

La distinción clave de Recop: `INACTIVE` no es "borrado". Un servidor inactivo
conserva todos sus datos y vuelve a levantar igual. Solo deja de aceptar
conexiones.

`ACTIVE` es el único estado en el que el servidor acepta tráfico.

Sobre por qué no hay un estado `DELETING`: se evaluó y se descartó. El borrado
es una operación síncrona e inmediata, así que un estado intermedio "borrando"
nunca sería observable por ningún cliente. Un estado que nadie puede ver solo
suma ruido al grafo. Si algún día el borrado se vuelve asíncrono porque hay
historial pesado que limpiar, ahí vuelve, y la capa de service ya tiene el
punto de extensión.
"""

from __future__ import annotations

from enum import StrEnum


class ServerStatus(StrEnum):
    """Ciclo de vida de un servidor."""

    CREATING = "creating"
    """Se está configurando. Todavía no acepta tráfico.

    Efímero: `create_server` lo usa dentro de la misma transacción y nunca lo
    expone al cliente. Existe para que el estado inicial sea explícito en el
    modelo en vez de implícito.
    """

    ACTIVE = "active"
    """Corriendo. Acepta conexiones. El puerto está abierto."""

    INACTIVE = "inactive"
    """Apagado, o con el proceso caído. Conserva todos sus datos."""

    DELETED = "deleted"
    """Eliminado por el dueño. Estado terminal."""

    @property
    def accepts_traffic(self) -> bool:
        """Si el servidor está en condiciones de atender conexiones."""
        return self is ServerStatus.ACTIVE

    @property
    def is_terminal(self) -> bool:
        """Si no hay más transiciones posibles desde acá."""
        return self is ServerStatus.DELETED


#: Transiciones válidas del ciclo de vida.
#:
#: Deliberadamente no existe `ACTIVE → ACTIVE`: activar un servidor ya activo
#: es un no-op explícito en el service, no una transición.
TRANSITIONS: dict[ServerStatus, frozenset[ServerStatus]] = {
    ServerStatus.CREATING: frozenset(
        {ServerStatus.ACTIVE, ServerStatus.INACTIVE, ServerStatus.DELETED}
    ),
    ServerStatus.ACTIVE: frozenset({ServerStatus.INACTIVE, ServerStatus.DELETED}),
    ServerStatus.INACTIVE: frozenset({ServerStatus.ACTIVE, ServerStatus.DELETED}),
    ServerStatus.DELETED: frozenset(),
}


def can_transition(current: ServerStatus, target: ServerStatus) -> bool:
    """Si se puede pasar de `current` a `target`."""
    return target in TRANSITIONS.get(current, frozenset())


def next_states(current: ServerStatus) -> frozenset[ServerStatus]:
    """Estados alcanzables desde `current`."""
    return TRANSITIONS.get(current, frozenset())
