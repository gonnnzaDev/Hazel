"""Reglas del Nickname: la única forma de identidad en Recop.

Decisión de producto: **no hay cuentas globales**. Una persona es un nickname
dentro de un servidor. El mismo nickname en dos servidores distintos son dos
personas distintas y no se relacionan entre sí.

Este módulo centraliza las reglas para que la validación sea idéntica al crear
un servidor, al unirse a uno y al mostrar un perfil.
"""

from __future__ import annotations

import re
import unicodedata

from core.api.errors import ValidationDomainError

# Alfabeto pensado para tipear rápido: letras, números, guion bajo, guion medio
# y punto. Todo en minúsculas: los nicknames no distinguen mayúsculas.
NICKNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

MIN_LENGTH = 2
MAX_LENGTH = 32

# Nicknames reservados: no pueden colisionar con menciones ni permisos del sistema.
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
    """Normaliza la forma canónica de un nickname.

    Quita acentos, pasa a minúsculas y colapsa espacios a guion bajo. Asi
    `"  José  Luis "` y `"jose_luis"` son el mismo nickname.
    """
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    # Cualquier cosa que no sea alfanumérico o separador se descarta.
    cleaned = re.sub(r"[^a-z0-9._-]+", "_", without_accents)
    return cleaned.strip("._-")


def validate(nickname: str) -> str:
    """Valida y normaliza un nickname. Devuelve la forma canónica.

    Lanza `ValidationDomainError` si no cumple las reglas.
    """
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
    """Versión booleana de `validate`, para chequeos rápidos."""
    try:
        validate(nickname)
    except ValidationDomainError:
        return False
    return True
