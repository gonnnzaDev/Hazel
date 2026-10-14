"""Node endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from apps.node import services
from apps.node.schemas import NodeAddress, NodeInfo

router = APIRouter()


@router.get("", response_model=NodeInfo, summary="Ficha del nodo")
async def node_info() -> NodeInfo:
    """Describe this process and its listening port."""
    return NodeInfo.model_validate(services.node_info())


@router.get("/address", response_model=NodeAddress, summary="Dirección para compartir")
async def node_address() -> NodeAddress:
    """Reachable node address; resolves wildcard bind to usable interfaces."""
    return NodeAddress.model_validate(services.node_address())
