"""CLI entry: node control plane and single-group processes.

Groups spawn via `python -m core group` in the same interpreter; stdin pipe EOF reaps orphans.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from core.config import Settings, get_settings


def _setup_logging(settings: Settings, role: str) -> None:
    """Stderr logging; role prefix distinguishes node/group lines."""
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
    """Node control-plane process."""
    _setup_logging(settings, "node")

    from core.app import create_node_app
    from core.run import run_node

    app = create_node_app()
    return asyncio.run(run_node(app, settings, reload=args.reload, log_level=args.log_level))


def _run_group(settings: Settings, args: argparse.Namespace) -> int:
    """Single-group process on its own port."""
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
    """Pyproject entrypoint."""
    raise SystemExit(main())


if __name__ == "__main__":
    run()
