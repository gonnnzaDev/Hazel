"""Capa API de `common`.

Por ahora `common` no expone endpoints públicos: aporta tipos, utilidades y
reglas compartidas. El router existe para que el registro de apps sea uniforme
y no haga falta un caso especial cuando una app no tiene rutas.
"""

from fastapi import APIRouter

router = APIRouter()
