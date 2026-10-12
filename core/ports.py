"""Asignación de puertos: un puerto por grupo.

## Por qué un puerto por grupo

Cada grupo corre en su propio proceso. Cada proceso escucha en su propio puerto.
Eso es lo que hace que un grupo que se cuelga no se lleve por delante a los
demás, y que el dueño pueda apagar un grupo sin tocar el resto.

También significa que el dueño comparte un `host:puerto` distinto por grupo, que
es exactamente como se compartía un servidor antes de que existiera internet.

## Cómo se reserva un puerto

En este orden:

1. Se toma el puerto que el grupo ya tenía asignado y sigue libre.
2. Si no, se busca el primero libre a partir de `RECOP_PORT + 1`, dentro del
   rango configurado.
3. Se comprueba contra **dos** cosas: que ningún proceso del sistema lo esté
   usando, y que ningún otro grupo activo lo tenga tomado en la base.

Las dos comprobaciones hacen falta. La base evita que dos grupos del mismo nodo
choquen entre sí. El sistema evita que el nodo se quede sin arrancar porque el
puerto 7273 lo tiene un programa que no es nuestro.
"""

from __future__ import annotations

import contextlib
import socket

from core.config import Settings

#: Espaciado para comprobar si un puerto está libre.
#:
#: BIND en vez de connect: conectar a un puerto abierto del sistema da "ok" y no
#: dice nada. BIND falla si algo ya lo tiene tomado, que es lo que queremos.
_PROBE_TIMEOUT = 0.2


def is_port_free(port: int, host: str = "0.0.0.0") -> bool:  # noqa: S104
    """Si el puerto está libre en esta máquina.

    No dice nada sobre grupos ya registrados en la base: eso lo resuelve
    `next_available_port` con la consulta.
    """
    if not 1 <= port <= 65535:
        return False

    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        # SO_REUSEADDR solo para no chocar con conexiones en TIME_WAIT de este
        # mismo proceso. No permite saltear un bind activo de otro proceso.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(_PROBE_TIMEOUT)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def port_range(settings: Settings) -> range:
    """El rango de puertos que este nodo puede repartir entre grupos.

    Empieza en `RECOP_PORT + 1` porque ese lo usa el proceso del nodo. Termina
    en `RECOP_GROUP_PORT_END`, que por defecto llega hasta el 7400.
    """
    first = settings.port + 1
    last = settings.group_port_end
    if last < first:
        return range(0)
    return range(first, last + 1)


def next_available_port(
    settings: Settings,
    *,
    preferred: int | None = None,
    taken: set[int] | None = None,
) -> int | None:
    """El próximo puerto libre, o `None` si se agotó el rango.

    `taken` son los puertos que otros grupos de este nodo ya tienen asignados.
    Se pasa por parámetro en vez de consultarlo acá para que esta función sea
    pura y se pueda testear sin base de datos.

    `preferred` es el puerto que el grupo ya tenía. Si sigue libre se reusa: no
    hay razón para mover un grupo de puerto porque otro se movió.
    """
    used = taken or set()
    candidates = port_range(settings)

    if (
        preferred is not None
        and preferred in candidates
        and preferred not in used
        and is_port_free(preferred, settings.host)
    ):
        return preferred

    for port in candidates:
        if port in used:
            continue
        if is_port_free(port, settings.host):
            return port

    return None
