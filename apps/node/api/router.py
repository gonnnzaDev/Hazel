"""Endpoints del nodo."""

from __future__ import annotations

from fastapi import APIRouter

from apps.node import services
from apps.node.schemas import NodeAddress, NodeInfo

router = APIRouter()


@router.get("", response_model=NodeInfo, summary="Ficha del nodo")
async def node_info() -> NodeInfo:
    """Qué es este proceso y en qué puerto escucha.

    Es lo primero que consulta un cliente para saber a qué se conectó.
    """
    return NodeInfo.model_validate(services.node_info())


@router.get("/address", response_model=NodeAddress, summary="Dirección para compartir")
async def node_address() -> NodeAddress:
    """La dirección real por la que entran al nodo.

    El nodo escucha en `0.0.0.0`, que no se puede conectar. Acá se resuelve
    cuáles de las interfaces de la máquina sí sirven, ordenadas por probabilidad,
    para que el dueño comparta una que funcione.
    """
    return NodeAddress.model_validate(services.node_address())
