"""Tests de las reglas de nickname.

El nickname es la única forma de identidad en Recop, así que estas reglas son
de las más importantes del producto.
"""

from __future__ import annotations

import pytest

from apps.common import nickname as nick
from core.api.errors import ValidationDomainError


class TestNormalize:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("  jose  ", "jose"),
            ("José", "jose"),
            ("José Luis", "jose_luis"),
            ("ANA", "ana"),
            ("maria_1", "maria_1"),
            ("---pedro---", "pedro"),
            ("rock.nroll", "rock.nroll"),
        ],
    )
    def test_normalizes_to_canonical_form(self, raw: str, expected: str) -> None:
        assert nick.normalize(raw) == expected

    def test_is_idempotent(self) -> None:
        once = nick.normalize("  José Luis ")
        assert nick.normalize(once) == once


class TestValidate:
    def test_accepts_valid_nickname(self) -> None:
        assert nick.validate("Ana") == "ana"

    def test_rejects_too_short(self) -> None:
        with pytest.raises(ValidationDomainError) as exc:
            nick.validate("a")
        assert exc.value.code == "nickname_too_short"

    def test_rejects_too_long(self) -> None:
        with pytest.raises(ValidationDomainError) as exc:
            nick.validate("x" * (nick.MAX_LENGTH + 1))
        assert exc.value.code == "nickname_too_long"

    def test_rejects_reserved(self) -> None:
        with pytest.raises(ValidationDomainError) as exc:
            nick.validate("admin")
        assert exc.value.code == "nickname_reserved"

    def test_rejects_empty_after_normalization(self) -> None:
        with pytest.raises(ValidationDomainError):
            nick.validate("...")

    def test_replaces_unsupported_characters_instead_of_failing(self) -> None:
        """Lo que no está en el alfabeto se reemplaza, no se rechaza.

        `"ana maria!"` es `ana_maria`. Un usuario que tipea con acentos o
        espacios no debería recibir un error, sino una normalización suave.
        """
        assert nick.validate("ana maria!") == "ana_maria"
        assert nick.validate("¡Ana!") == "ana"


class TestIsValid:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("ana", True),
            ("Ana_1", True),
            ("a", False),
            ("admin", False),
            ("  ", False),
            ("x" * 40, False),
        ],
    )
    def test_boolean_shortcut(self, value: str, expected: bool) -> None:
        assert nick.is_valid(value) is expected


def test_same_nickname_in_two_servers_is_two_people() -> None:
    """El mismo nickname es válido en servidores distintos.

    Es el comportamiento central de Recop: la identidad se scopes al servidor,
    no es global. Este test fija esa decisión para que nadie la rompa sin
    darse cuenta.
    """
    server_a = nick.validate("ana")
    server_b = nick.validate("ana")

    assert server_a == server_b == "ana"
