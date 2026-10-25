from pydantic import BaseModel, Field


class EventsSection(BaseModel):
    typing_rate_per_minute: int = Field(default=15, ge=1)
    websocket_idle_timeout_seconds: int = Field(default=300, ge=10)
    websocket_queue_size: int = Field(default=128, ge=8)
