"""Contratos del nodo."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from core.network import LocalAddress


class NodeInfo(BaseModel):
    """Ficha del nodo.

    Dice qué es este proceso y en qué puerto escucha. Es lo primero que un
    cliente consulta para saber a qué se conectó.
    """

    model_config = ConfigDict(from_attributes=True)

    service: str
    version: str
    environment: str
    bind_host: str
    bind_port: int
    is_listening: bool
    kafka_topic_prefix: str


class NodeAddress(BaseModel):
    """La dirección por la que otras personas entran al nodo."""

    model_config = ConfigDict(from_attributes=True)

    port: int
    bind_host: str
    is_wildcard: bool
    """Si el nodo escucha en todas las interfaces.

    Cuando es `true`, `bind_host` no sirve para conectarse: hay que usar una de
    las direcciones de `candidates`.
    """

    candidates: list[LocalAddress]
    """Direcciones reales de la máquina, ordenadas por probabilidad."""

    recommended: str | None
    """La primera de `candidates`. Sugerencia, no garantía: el cliente puede
    mostrar todas y dejar que el dueño elija."""
