"""Entrada de línea de comandos de Recop.

Hay dos roles, y por eso hay dos comandos:

    python -m core                  el NODO: el plano de control que corre el dueño
    python -m core group --port=…   un GRUPO: el proceso que sirve un grupo

## Por qué dos comandos y no dos binarios

El nodo lanza los grupos con `python -m core group`, en el mismo intérprete y
con el mismo entorno virtual. Dos binarios separados obligarían a instalar dos
veces y a que las versiones puedan desfasarse sin que nadie lo note.

## La guardia del stdin

El nodo le pasa a cada grupo la escritura de un pipe como `stdin`. Cuando el
nodo muere, el pipe se cierra y el grupo lee EOF: se apaga solo.

Es lo que evita que queden procesos zombis ocupando puertos. Un archivo de pid o
`PR_SET_PDEATHSIG` también sirven, pero el pipe funciona igual en las cuatro
plataformas sin código condicional, y es el único que sobrevive a que el nodo
muera de forma abrupta.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from core.config import Settings, get_settings


def _setup_logging(settings: Settings, role: str) -> None:
    """Logging a stderr, con un formato que se pueda greppear.

    Los grupos escriben en el mismo log que el nodo, así que el prefijo dice de
    quién es cada línea.
    """
    logging.basicConfig(
        level=logging.DEBUG if settings.debug else logging.INFO,
        format=f"%(asctime)s {role:<5} %(levelname)-7s %(name)s: %(message)s",
        stream=sys.stderr,
        force=True,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="recop",
        description="Nodo Recop",
    )
    parser.add_argument("--host", default=None, help="Interfaz donde escuchar")
    parser.add_argument("--port", type=int, default=None, help="Puerto donde escuchar")
    parser.add_argument("--reload", action="store_true", help="Recarga al cambiar el código")
    parser.add_argument("--log-level", default=None, help="debug | info | warning | error")

    sub = parser.add_subparsers(dest="role")

    group = sub.add_parser("group", help="Servir un solo grupo (lo lanza el nodo)")
    group.add_argument("--server-id", required=True, help="Id del grupo a servir")
    group.add_argument("--port", type=int, required=True, help="Puerto de este grupo")
    group.add_argument("--host", default=None, dest="group_host")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    settings = get_settings()

    if args.host is not None:
        settings.host = args.host
    if args.port is not None:
        settings.port = args.port
    if args.log_level is not None:
        level = getattr(logging, args.log_level.upper(), None)
        if isinstance(level, int):
            settings.debug = level <= logging.DEBUG

    if args.role == "group":
        return _run_group(settings, args)
    return _run_node(settings, args)


def _run_node(settings: Settings, args: argparse.Namespace) -> int:
    """El proceso del nodo: el plano de control."""
    _setup_logging(settings, "node")

    from core.app import create_node_app
    from core.run import run_node

    app = create_node_app()
    return asyncio.run(run_node(app, settings, reload=args.reload, log_level=args.log_level))


def _run_group(settings: Settings, args: argparse.Namespace) -> int:
    """Un proceso de grupo: sirve un solo grupo en su propio puerto."""
    _setup_logging(settings, "group")

    host = getattr(args, "group_host", None) or settings.host
    from core.run import run_group

    return asyncio.run(
        run_group(
            server_id=args.server_id,
            host=host,
            port=args.port,
            log_level=args.log_level,
        )
    )


def run() -> None:
    """Entrypoint declarado en `pyproject.toml`."""
    raise SystemExit(main())


if __name__ == "__main__":
    run()
