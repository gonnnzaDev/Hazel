from pydantic import BaseModel, Field


class LimitsSection(BaseModel):
    rate_limit_messages_per_minute: int = Field(default=20, ge=1)
    max_message_bytes: int = Field(default=4000, ge=1)
