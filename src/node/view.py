from __future__ import annotations

from fastapi import APIRouter

from node import service
from node.schemas import NodeAddress, NodeInfo

router = APIRouter()


@router.get("", response_model=NodeInfo, summary="Node card")
async def node_info() -> NodeInfo:
    return NodeInfo.model_validate(service.node_info())


@router.get("/address", response_model=NodeAddress, summary="Shareable address")
async def node_address() -> NodeAddress:
    return NodeAddress.model_validate(service.node_address())
