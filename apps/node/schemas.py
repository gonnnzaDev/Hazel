"""Node contracts."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from core.network import LocalAddress


class NodeInfo(BaseModel):
    """Node card: what this process is and where it listens."""

    model_config = ConfigDict(from_attributes=True)

    service: str
    version: str
    environment: str
    bind_host: str
    bind_port: int
    is_listening: bool
    kafka_topic_prefix: str


class NodeAddress(BaseModel):
    """Address others use to reach the node."""

    model_config = ConfigDict(from_attributes=True)

    port: int
    bind_host: str
    is_wildcard: bool
    """True when bound to all interfaces; then use candidates."""

    candidates: list[LocalAddress]
    """Real machine addresses, best-first."""

    recommended: str | None
    """First candidate; suggestion, not guarantee."""
