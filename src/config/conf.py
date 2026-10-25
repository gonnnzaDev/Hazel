from functools import lru_cache
from pathlib import Path

from pydantic import ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from config.app_config import AppSection
from config.call_config import CallSection
from config.db_config import DbSection
from config.events_config import EventsSection
from config.http_config import HttpSection
from config.kafka_config import KafkaSection
from config.limits_config import LimitsSection

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(
    BaseSettings,
    AppSection,
    HttpSection,
    DbSection,
    KafkaSection,
    LimitsSection,
    CallSection,
    EventsSection,
):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="HAZEL_",
        extra="ignore",
    )


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
