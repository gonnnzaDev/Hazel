from pydantic import BaseModel, Field, field_validator

from config.fields import CsvList


class CallSection(BaseModel):
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
            "Hazel does not depend on any external one to work."
        ),
    )

    @field_validator("call_ice_servers", mode="before")
    @classmethod
    def _split_ice(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value
