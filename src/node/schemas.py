from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from core.network import LocalAddress


class NodeInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    service: str
    version: str
    environment: str
    bind_host: str
    bind_port: int
    is_listening: bool
    kafka_topic_prefix: str


class NodeAddress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    port: int
    bind_host: str
    is_wildcard: bool

    candidates: list[LocalAddress]

    recommended: str | None
