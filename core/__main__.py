"""Permite ejecutar el nodo con `python -m core`.

    uv run python -m core --port 7272

Es la forma recomendada en desarrollo: `uv run <script-del-propio-proyecto>`
falla con "Failed to spawn" en algunas versiones de uv, mientras que la
invocación por módulo funciona siempre y en cualquier entorno.
"""

from core.cli import run

if __name__ == "__main__":
    run()
