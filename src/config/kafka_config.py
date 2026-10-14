from pydantic import BaseModel, Field, computed_field, field_validator

from config.fields import CsvList


class KafkaSection(BaseModel):
    kafka_bootstrap_servers: CsvList = Field(default_factory=lambda: ["localhost:9092"])
    kafka_topic_prefix: str = "hazel"
    kafka_client_id: str = ""
    kafka_max_poll_records: int = Field(default=500, ge=1)

    @field_validator("kafka_bootstrap_servers", mode="before")
    @classmethod
    def _split_kafka(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kafka_client_id_resolved(self) -> str:
        return self.kafka_client_id or f"hazel-{self.env}"  # type: ignore[attr-defined]

    def kafka_topic(self, name: str) -> str:
        return f"{self.kafka_topic_prefix}.{name}"
