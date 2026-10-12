"""Permite ejecutar el nodo o un grupo con `python -m core`.

    uv run python -m core node  --port 7272          # el nodo del dueño
    uv run python -m core group --server-id=... --port 7273   # un grupo

Es la forma recomendada en desarrollo: `uv run <script-del-propio-proyecto>`
falla con "Failed to spawn" en algunas versiones de uv, mientras que la
invocación por módulo funciona siempre y en cualquier entorno.

Sin subcomando, `python -m core` arranca el nodo.
"""

from core.run import main

if __name__ == "__main__":
    main()
