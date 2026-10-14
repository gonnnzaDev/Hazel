from pydantic import BaseModel, Field, field_validator

from config.fields import CsvList

WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "[::]"})  # noqa: S104


class HttpSection(BaseModel):
    host: str = "0.0.0.0"  # noqa: S104
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

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def bind_host_is_wildcard(self) -> bool:
        return self.host.strip() in WILDCARD_HOSTS
