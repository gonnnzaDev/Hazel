"""Utilidad de línea de comandos del nodo Recop.

    uv run python -m core                  # levanta la API con uvicorn
    uv run python -m core --reload         # modo desarrollo
    uv run python -m core --port 9000      # override del puerto

En instalaciones reales del paquete queda disponible también el console script
`recop-api`. En desarrollo se prefiere `python -m core`: algunas versiones de
`uv` no logran ejecutar `uv run <script del propio proyecto>`.
"""

from __future__ import annotations

import argparse

import uvicorn

from core.config import get_settings


def main() -> None:
    settings = get_settings()

    parser = argparse.ArgumentParser(prog="recop-api", description="Nodo Recop")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--reload", action="store_true", help="Recarga al cambiar el código")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    uvicorn.run(
        "core.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
        # Mantiene vivas las conexiones WebSocket del chat durante momentos de
        # inactividad del cliente.
        timeout_keep_alive=30,
        ws_ping_interval=20,
        ws_ping_timeout=20,
    )


def run() -> None:
    """Entrypoint declarado en `pyproject.toml`."""
    main()


if __name__ == "__main__":
    run()
