"""Roles. Tres niveles, y el dueño no se toca.

La cantidad de roles es una decisión de producto, no técnica. Con tres alcanza
para la primera versión: no hay permisos granulares ni roles personalizados. Si
hacen falta, el modelo ya tiene dónde crecer.
"""

from __future__ import annotations

from enum import IntEnum


class Role(IntEnum):
    """Rol de un miembro dentro de un servidor.

    Es un `IntEnum` y no un `StrEnum` a propósito: el orden importa. Comparar
    roles es una comparación de enteros, y `owner` (100) > `admin` (50) > `member`
    (10) sale solo. Con strings habría que mirar un diccionario cada vez.
    """

    MEMBER = 10
    """Puede chatear. El rol de cualquiera que entra."""

    ADMIN = 50
    """Puede gestionar canales, miembros y roles. No puede borrar el servidor."""

    OWNER = 100
    """Puede todo, incluido borrar el servidor. No se puede quitar ni ceder."""

    @property
    def label(self) -> str:
        return self.name.lower()

    @property
    def can_administer(self) -> bool:
        """Si tiene permisos de administración del servidor."""
        return self >= Role.ADMIN

    @property
    def can_delete_server(self) -> bool:
        """Si puede eliminar el servidor. Solo el dueño."""
        return self is Role.OWNER

    @classmethod
    def from_label(cls, label: str) -> Role:
        """Convierte `"admin"` en `Role.ADMIN`.

        Acepta el string que viene por la API, que es lo que el cliente ve.
        """
        try:
            return cls[label.upper()]
        except KeyError:
            raise ValueError(f"Rol desconocido: {label!r}") from None


#: El dueño no se puede quedar sin dueño. Si alguien se va, el rol pasa a otro.
#: Ver `apps.identity.services.kick_member`.
DEFAULT_ROLE = Role.MEMBER
