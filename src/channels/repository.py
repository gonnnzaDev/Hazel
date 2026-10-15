from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from channels.model import Channel, ChannelKind
from channels.schemas import ChannelCreate
from common.types import new_id
from core.api.errors import ValidationDomainError

logger = logging.getLogger(__name__)

DEFAULT_CHANNEL_NAME = "general"


def build_channels(payload_channels: list[ChannelCreate]) -> list[Channel]:
    channels: list[Channel] = []
    for raw in payload_channels:
        try:
            kind = ChannelKind(raw.kind)
        except ValueError:
            raise ValidationDomainError(
                f"'{raw.kind}' is not a valid channel kind.",
                code="invalid_channel_kind",
                extra={"allowed": [k.value for k in ChannelKind]},
            ) from None
        channels.append(
            Channel(
                id=new_id(),
                name=raw.name.strip(),
                kind=kind,
                topic=raw.topic,
                position=raw.position,
                is_default=raw.is_default,
            )
        )
    return channels


def ensure_default_channel(channels: list[Channel]) -> None:
    if not channels:
        channels.append(
            Channel(
                id=new_id(),
                name=DEFAULT_CHANNEL_NAME,
                kind=ChannelKind.TEXT,
                is_default=True,
            )
        )
        return

    defaults = [c for c in channels if c.is_default]
    if len(defaults) > 1:
        raise ValidationDomainError(
            "A server cannot have more than one default channel.",
            code="multiple_default_channels",
        )
    if not defaults:
        channels[0].is_default = True
