from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from config.conf import Settings, get_settings


def _setup_logging(settings: Settings, role: str) -> None:
    logging.basicConfig(
        level=logging.DEBUG if settings.debug else logging.INFO,
        format=f"%(asctime)s {role:<5} %(levelname)-7s %(name)s: %(message)s",
        stream=sys.stderr,
        force=True,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hazel",
        description="Hazel node",
    )
    parser.add_argument("--host", default=None, help="Interface to listen on")
    parser.add_argument("--port", type=int, default=None, help="Port to listen on")
    parser.add_argument("--reload", action="store_true", help="Reload on code changes")
    parser.add_argument("--log-level", default=None, help="debug | info | warning | error")

    sub = parser.add_subparsers(dest="role")

    group = sub.add_parser("group", help="Serve a single group (launched by the node)")
    group.add_argument("--server-id", required=True, help="ID of the group to serve")
    group.add_argument("--port", type=int, required=True, help="Port for this group")
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
    _setup_logging(settings, "node")

    from core.app import create_node_app
    from core.run import run_node

    app = create_node_app()
    return asyncio.run(run_node(app, settings, reload=args.reload, log_level=args.log_level))


def _run_group(settings: Settings, args: argparse.Namespace) -> int:
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
    raise SystemExit(main())


if __name__ == "__main__":
    run()
