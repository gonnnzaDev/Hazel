"""Node and single-group process startup.

Call signaling rides on the same apps; no external media or signaling services.
"""

from __future__ import annotations

import argparse
import logging

import uvicorn

from core.config import get_settings

logger = logging.getLogger(__name__)


def run_node(*, host: str, port: int) -> None:
    """Start the node process with its group supervisor in app.state."""
    from core.app import create_node_app
    from core.supervisor import GroupSupervisor

    settings = get_settings()

    supervisor = GroupSupervisor(db_url=settings.database_url, host=host)
    app = create_node_app(settings)
    app.state.supervisor = supervisor

    logger.info("nodo Recop escuchando en %s:%s", host, port)
    # Pass the app object, not the import string: this instance carries the supervisor.
    uvicorn.run(app, host=host, port=port, log_level="info")


def run_group(*, server_id: str, host: str, port: int) -> None:
    """Start a single-group process; it carries no supervisor."""
    from core.app import create_group_app

    settings = get_settings()
    app = create_group_app(server_id=server_id, settings=settings)

    logger.info("grupo %s escuchando en %s:%s", server_id, host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


def build_parser() -> argparse.ArgumentParser:
    """Parser with `node` (default) and `group` subcommands."""
    parser = argparse.ArgumentParser(prog="recop", description="Chat autoservido Recop")
    sub = parser.add_subparsers(dest="role")

    node = sub.add_parser("node", help="Proceso del nodo: el panel del dueño")
    node.add_argument("--host", default=None)
    node.add_argument("--port", type=int, default=None)

    group = sub.add_parser("group", help="Proceso de un grupo (lo lanza el nodo)")
    group.add_argument("--server-id", required=True)
    group.add_argument("--host", default=None)
    group.add_argument("--port", type=int, required=True)

    return parser


def main(argv: list[str] | None = None) -> None:
    """python -m core entrypoint; no subcommand starts the node."""
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = get_settings()

    host = args.host or settings.host
    port = args.port or settings.port

    if args.role == "group":
        run_group(server_id=args.server_id, host=host, port=port)
    else:
        run_node(host=host, port=port)


if __name__ == "__main__":
    main()
