"""Nickname rules: the only identity in Recop.

Nicknames are per-server; the same string on two servers means two unrelated people.
"""

from __future__ import annotations

import re
import unicodedata

from core.api.errors import ValidationDomainError

# Lowercase alphanumerics plus ._-; nicknames are case-insensitive.
NICKNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

MIN_LENGTH = 2
MAX_LENGTH = 32

# Reserved to avoid collisions with mentions/system names.
RESERVED = frozenset(
    {
        "admin",
        "administrador",
        "everyone",
        "todos",
        "here",
        "aqui",
        "recop",
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
    """Return canonical form: lowercase, de-accented, spaces collapsed to underscores."""
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    # Drop anything outside the allowed alphabet.
    cleaned = re.sub(r"[^a-z0-9._-]+", "_", without_accents)
    return cleaned.strip("._-")


def validate(nickname: str) -> str:
    """Validate and return canonical form. Raises ValidationDomainError."""
    normalized = normalize(nickname)

    if len(normalized) < MIN_LENGTH:
        raise ValidationDomainError(
            f"El nickname debe tener al menos {MIN_LENGTH} caracteres.",
            code="nickname_too_short",
            extra={"min_length": MIN_LENGTH},
        )

    if len(normalized) > MAX_LENGTH:
        raise ValidationDomainError(
            f"El nickname no puede superar los {MAX_LENGTH} caracteres.",
            code="nickname_too_long",
            extra={"max_length": MAX_LENGTH},
        )

    if not NICKNAME_PATTERN.match(normalized):
        raise ValidationDomainError(
            "El nickname solo puede contener letras, números, punto, guion y guion bajo, "
            "y debe empezar por letra o número.",
            code="nickname_invalid_charset",
        )

    if normalized in RESERVED:
        raise ValidationDomainError(
            f"'{normalized}' es un nickname reservado.",
            code="nickname_reserved",
        )

    return normalized


def is_valid(nickname: str) -> bool:
    """Boolean version of validate."""
    try:
        validate(nickname)
    except ValidationDomainError:
        return False
    return True
