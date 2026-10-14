from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field


@dataclass(slots=True)
class CallIdentity:

    member_id: str
    nickname: str
    display_name: str


class CallParticipant(BaseModel):

    member_id: str
    nickname: str
    display_name: str
    mic: bool
    cam: bool


class CallParticipantsResponse(BaseModel):

    channel_id: str
    participants: list[CallParticipant] = Field(default_factory=list)
    count: int
    max: int
