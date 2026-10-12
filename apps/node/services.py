"""Lógica del nodo.

Es puramente de lectura: el nodo no tiene estado propio en la base, todo sale de
la configuración del proceso y de las interfaces de red de la máquina.
"""

from __future__ import annotations

from core import __version__
from core.config import get_settings
from core.network import local_addresses


def get_node_info() -> dict[str, object]:
    """Ficha del nodo."""
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


def get_node_address() -> dict[str, object]:
    """Dirección real del nodo, con las candidatas de la máquina.

    El nodo escucha en `0.0.0.0`, que no es una dirección a la que se pueda
    conectar. Acá se resuelve cuáles sí lo son.
    """
    settings = get_settings()
    addresses = local_addresses()

    return {
        "port": settings.port,
        "bind_host": settings.host,
        "is_wildcard": settings.bind_host_is_wildcard,
        "candidates": addresses,
        "recommended": addresses[0].host if addresses else None,
    }
