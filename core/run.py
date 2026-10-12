"""Arranque de los dos roles: el nodo del dueño y los procesos de grupo.

    python -m core node    --port 7272        # el plano de control del dueño
    python -m core group   --server-id=... --port 7273   # un grupo (lo lanza el nodo)

- `run_node`: monta la app del nodo, le cuelga el supervisor y escucha. Desde
  acá el dueño crea, enciende y apaga grupos. Cada grupo que se enciende corre
  en su **propio proceso**, en su **propio puerto**, y sirve su chat y sus
  llamadas.
- `run_group`: sirve **un solo grupo** en su puerto. Es lo que el supervisor
  lanza con `python -m core group ...`.

Todo el signaling de llamadas (WebRTC) viaja por estas mismas apps: en el nodo
para el modo de un solo proceso, y en el proceso de cada grupo en producción. No
hay un servidor de medios aparte: los pares se conectan directo y el servidor
solo los presenta. Ver `apps/servers/calls.py`.

Nada de esto depende de servicios externos. No hay LiveKit, ni Kafka obligatorio,
ni señalizador de terceros: es WebRTC estándar del lado del cliente y lógica
propia del lado del servidor.
"""

from __future__ import annotations

import argparse
import logging

import uvicorn

from core.config import get_settings

logger = logging.getLogger(__name__)


def run_node(*, host: str, port: int) -> None:
    """Levanta el proceso del nodo con su supervisor de grupos.

    El supervisor vive en `app.state` porque es estado del proceso, no de una
    request. Lo crea y lo cuelga acá, antes de servir: así los endpoints del
    nodo (`apps.node.services`) lo encuentran y pueden desplegar grupos.
    """
    from core.app import create_node_app
    from core.supervisor import GroupSupervisor

    settings = get_settings()

    supervisor = GroupSupervisor(db_url=settings.database_url, host=host)
    app = create_node_app(settings)
    app.state.supervisor = supervisor

    logger.info("nodo Recop escuchando en %s:%s", host, port)
    # Se pasa el objeto app, no el string "core.app:app": necesitamos esta
    # instancia concreta, la que tiene el supervisor colgado.
    uvicorn.run(app, host=host, port=port, log_level="info")


def run_group(*, server_id: str, host: str, port: int) -> None:
    """Levanta el proceso de un grupo en su puerto.

    Lo lanza el supervisor del nodo. Sirve un único grupo: su API, su chat y sus
    llamadas. No tiene supervisor (un grupo no maneja otros grupos), y por eso
    `apps.node.services.supervisor_from` falla con un mensaje claro si alguien
    intenta desplegar desde acá.
    """
    from core.app import create_group_app

    settings = get_settings()
    app = create_group_app(server_id=server_id, settings=settings)

    logger.info("grupo %s escuchando en %s:%s", server_id, host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


def build_parser() -> argparse.ArgumentParser:
    """El parser con los dos subcomandos: `node` (default) y `group`."""
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
    """Punto de entrada de `python -m core`.

    Sin subcomando arranca el nodo: es lo que quiere la mayoría al escribir
    `python -m core`. Con `group`, sirve un proceso de grupo.
    """
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
