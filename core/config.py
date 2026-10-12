"""Configuración de la aplicación, cargada desde el entorno.

Se usa `pydantic-settings` para que toda la configuración quede validada al
arrancar: si falta una variable requerida o tiene un tipo inválido, el proceso
falla rápido en vez de fallar en runtime.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, ValidationError, computed_field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent

Environment = Literal["local", "test", "prod"]

# Direcciones comodín: el proceso escucha en todas las interfaces.
WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104

# Las listas llegan desde el entorno como CSV (`a,b,c`). `NoDecode` le dice a
# pydantic-settings que no intente interpretarlas como JSON, para que el
# validador de abajo haga el split.
CsvList = Annotated[list[str], NoDecode]


class Settings(BaseSettings):
    """Configuración global del nodo Recop."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="RECOP_",
        extra="ignore",
    )

    # ─── Aplicación ────────────────────────────────────────────────────────────
    env: Environment = "local"
    debug: bool = False
    secret_key: str = Field(min_length=1)

    # ─── Servidor HTTP ─────────────────────────────────────────────────────────
    host: str = "0.0.0.0"  # noqa: S104 — por defecto debe escuchar en todas las interfaces
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

    # ─── Base de datos ─────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://recop:recop@localhost:5432/recop"
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=20, ge=0)
    db_echo: bool = False

    # ─── Kafka ─────────────────────────────────────────────────────────────────
    kafka_bootstrap_servers: CsvList = Field(default_factory=lambda: ["localhost:9092"])
    kafka_topic_prefix: str = "recop"
    kafka_client_id: str = ""
    kafka_max_poll_records: int = Field(default=500, ge=1)

    # ─── Límites de la aplicación ──────────────────────────────────────────────
    rate_limit_messages_per_minute: int = Field(default=20, ge=1)
    max_message_bytes: int = Field(default=4000, ge=1)

    # ─── Llamadas (señalización WebRTC) ────────────────────────────────────────
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

    # ─── Derivados ─────────────────────────────────────────────────────────────

    @field_validator("cors_origins", "kafka_bootstrap_servers", "call_ice_servers", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        """Acepta `a,b,c` desde el entorno y lo convierte a lista."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "prod"

    @property
    def sync_database_url(self) -> str:
        """URL síncrona, necesaria para las migraciones de Alembic."""
        return self.database_url.replace("+asyncpg", "")

    @property
    def bind_host_is_wildcard(self) -> bool:
        """Si el proceso escucha en todas las interfaces.

        Un nodo autohospedado casi siempre quiere esto: si escucha solo en
        `127.0.0.1`, nadie fuera de la máquina puede entrar.
        """
        return self.host.strip() in WILDCARD_HOSTS

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kafka_client_id_resolved(self) -> str:
        """Client ID para Kafka. Si no se setea, se deriva del entorno."""
        return self.kafka_client_id or f"recop-{self.env}"

    def kafka_topic(self, name: str) -> str:
        """Construye el nombre completo de un topic con el namespace configurado."""
        return f"{self.kafka_topic_prefix}.{name}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Devuelve la configuración cacheada a nivel de proceso.

    Si falta una variable requerida, el error se muestra como un mensaje
    accionable en vez de un traceback de Pydantic: el primer arranque del
    proyecto no debería exigir leer un stack trace.
    """
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
