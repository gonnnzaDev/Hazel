from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, ValidationError, computed_field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent

Environment = Literal["local", "test", "prod"]

WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104

CsvList = Annotated[list[str], NoDecode]


class Settings(BaseSettings):

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="RECOP_",
        extra="ignore",
    )

    env: Environment = "local"
    debug: bool = False
    secret_key: str = Field(min_length=1)

    host: str = "0.0.0.0"  # noqa: S104 — must listen on all interfaces by default
    port: int = Field(default=7272, ge=1, le=65535)
    group_port_end: int = Field(
        default=7400,
        ge=1024,
        le=65535,
        description=(
            "Last port the node may hand out to groups. Each group "
            "runs in its own process with its own port, so the node "
            "needs a range."
        ),
    )
    root_path: str = ""
    cors_origins: CsvList = Field(default_factory=lambda: ["*"])

    database_url: str = "postgresql+asyncpg://recop:recop@localhost:5432/recop"
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=20, ge=0)
    db_echo: bool = False

    kafka_bootstrap_servers: CsvList = Field(default_factory=lambda: ["localhost:9092"])
    kafka_topic_prefix: str = "recop"
    kafka_client_id: str = ""
    kafka_max_poll_records: int = Field(default=500, ge=1)

    rate_limit_messages_per_minute: int = Field(default=20, ge=1)
    max_message_bytes: int = Field(default=4000, ge=1)

    call_max_participants: int = Field(
        default=16,
        ge=2,
        le=200,
        description=(
            "Maximum participants per call. In full-mesh everyone connects "
            "to everyone, so upload bandwidth grows with the square of the "
            "headcount: this cap protects the owner's PC."
        ),
    )
    call_ice_servers: CsvList = Field(
        default_factory=list,
        description=(
            "ICE (STUN/TURN) servers for WebRTC, comma-separated. "
            "Empty by default: not needed on the same network or with a "
            "direct IP. To traverse NAT, configure your own STUN/TURN. "
            "Recop does not depend on any external one to work."
        ),
    )


    @field_validator("cors_origins", "kafka_bootstrap_servers", "call_ice_servers", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "prod"

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+asyncpg", "")

    @property
    def bind_host_is_wildcard(self) -> bool:
        return self.host.strip() in WILDCARD_HOSTS

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kafka_client_id_resolved(self) -> str:
        return self.kafka_client_id or f"recop-{self.env}"

    def kafka_topic(self, name: str) -> str:
        return f"{self.kafka_topic_prefix}.{name}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        missing = sorted(
            ".".join(str(part) for part in error["loc"]) or "<root>"
            for error in exc.errors()
            if error["type"] == "missing"
        )
        if missing:
            raise SystemExit(
                "Missing required configuration variables: "
                f"{', '.join(missing)}\n"
                "Generate your .env with ./scripts/setup.sh or define the variables "
                "in the environment."
            ) from exc
        raise SystemExit(
            f"Invalid configuration:\n{exc}\n"
            "Check your .env against the variables documented in docs/installation.md."
        ) from exc
