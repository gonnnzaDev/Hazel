"""Normalize + valid + reserved names."""

from __future__ import annotations

import re
import unicodedata

from core.api.errors import ValidationDomainError

NICKNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

MIN_LENGTH = 2
MAX_LENGTH = 32

RESERVED = frozenset(
    {
        "admin",
        "administrador",
        "everyone",
        "todos",
        "here",
        "aqui",
        "hazel",
        "system",
        "sistema",
        "root",
        "null",
        "none",
        "support",
        "soporte",
    }
)


def normalize(raw: str) -> str:
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    cleaned = re.sub(r"[^a-z0-9._-]+", "_", without_accents)
    return cleaned.strip("._-")


def validate(nickname: str) -> str:
    normalized = normalize(nickname)

    if len(normalized) < MIN_LENGTH:
        raise ValidationDomainError(
            f"Nickname must be at least {MIN_LENGTH} characters long.",
            code="nickname_too_short",
            extra={"min_length": MIN_LENGTH},
        )

    if len(normalized) > MAX_LENGTH:
        raise ValidationDomainError(
            f"Nickname cannot exceed {MAX_LENGTH} characters.",
            code="nickname_too_long",
            extra={"max_length": MAX_LENGTH},
        )

    if not NICKNAME_PATTERN.match(normalized):
        raise ValidationDomainError(
            "Nickname may only contain letters, numbers, dot, hyphen and "
            "underscore, and must start with a letter or number.",
            code="nickname_invalid_charset",
        )

    if normalized in RESERVED:
        raise ValidationDomainError(
            f"'{normalized}' is a reserved nickname.",
            code="nickname_reserved",
        )

    return normalized


def is_valid(nickname: str) -> bool:
    try:
        validate(nickname)
    except ValidationDomainError:
        return False
    return True
