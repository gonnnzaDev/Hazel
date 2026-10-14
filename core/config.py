"""Environment-loaded app config.

Validated at startup via pydantic-settings; fails fast on missing/invalid values.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, ValidationError, computed_field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent

Environment = Literal["local", "test", "prod"]

# Wildcard binds: listen on all interfaces.
WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104

# Env lists arrive as CSV; NoDecode leaves splitting to the validator below.
CsvList = Annotated[list[str], NoDecode]


class Settings(BaseSettings):
    """Global Recop node config."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="RECOP_",
        extra="ignore",
    )

    # ─── App ───────────────────────────────────────────────────────────────────
    env: Environment = "local"
    debug: bool = False
    secret_key: str = Field(min_length=1)

    # ─── HTTP server ───────────────────────────────────────────────────────────
    host: str = "0.0.0.0"  # noqa: S104 — must listen on all interfaces by default
    port: int = Field(default=7272, ge=1, le=65535)
    group_port_end: int = Field(
        default=7400,
        ge=1024,
        le=65535,
        description=(
            "Último puerto que el nodo puede repartir entre grupos. Cada grupo "
            "corre en su propio proceso con su propio puerto, así que el nodo "
            "necesita un rango."
        ),
    )
    root_path: str = ""
    cors_origins: CsvList = Field(default_factory=lambda: ["*"])

    # ─── Database ──────────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://recop:recop@localhost:5432/recop"
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=20, ge=0)
    db_echo: bool = False

    # ─── Kafka ─────────────────────────────────────────────────────────────────
    kafka_bootstrap_servers: CsvList = Field(default_factory=lambda: ["localhost:9092"])
    kafka_topic_prefix: str = "recop"
    kafka_client_id: str = ""
    kafka_max_poll_records: int = Field(default=500, ge=1)

    # ─── App limits ────────────────────────────────────────────────────────────
    rate_limit_messages_per_minute: int = Field(default=20, ge=1)
    max_message_bytes: int = Field(default=4000, ge=1)

    # ─── Calls (WebRTC signaling) ──────────────────────────────────────────────
    call_max_participants: int = Field(
        default=16,
        ge=2,
        le=200,
        description=(
            "Máximo de participantes por llamada. En full-mesh cada uno conecta "
            "con todos, así que el ancho de subida crece con el cuadrado del "
            "número de gente: este tope protege la PC del dueño."
        ),
    )
    call_ice_servers: CsvList = Field(
        default_factory=list,
        description=(
            "Servidores ICE (STUN/TURN) para WebRTC, separados por coma. "
            "Vacío por defecto: en la misma red o con IP directa no hace falta. "
            "Para atravesar NAT se configura un STUN/TURN propio. Recop no "
            "depende de ninguno externo para funcionar."
        ),
    )

    # ─── Derived ───────────────────────────────────────────────────────────────

    @field_validator("cors_origins", "kafka_bootstrap_servers", "call_ice_servers", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        """Split `a,b,c` env values into a list."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "prod"

    @property
    def sync_database_url(self) -> str:
        """Sync URL for Alembic migrations."""
        return self.database_url.replace("+asyncpg", "")

    @property
    def bind_host_is_wildcard(self) -> bool:
        """True when bound to all interfaces; loopback-only blocks LAN access."""
        return self.host.strip() in WILDCARD_HOSTS

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kafka_client_id_resolved(self) -> str:
        """Kafka client ID; defaults to env-derived value."""
        return self.kafka_client_id or f"recop-{self.env}"

    def kafka_topic(self, name: str) -> str:
        """Full topic name with configured prefix."""
        return f"{self.kafka_topic_prefix}.{name}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached process-wide settings with actionable missing-var errors."""
    try:
        return Settings()
    except ValidationError as exc:
        missing = sorted(
            ".".join(str(part) for part in error["loc"]) or "<raíz>"
            for error in exc.errors()
            if error["type"] == "missing"
        )
        if missing:
            raise SystemExit(
                "Faltan variables de configuración obligatorias: "
                f"{', '.join(missing)}\n"
                f"Revisá tu .env o copiá {REPO_ROOT / '.env.example'} a {REPO_ROOT / '.env'}."
            ) from exc
        raise SystemExit(
            f"La configuración es inválida:\n{exc}\n"
            f"Revisá tu .env contra {REPO_ROOT / '.env.example'}."
        ) from exc
