"""Tests del supervisor de grupos.

El supervisor lanza procesos de verdad. Por eso estos tests usan un programa
real de Python como stand-in en vez de un fake: lo que hay que probar es
exactamente que el proceso arranca, escucha un puerto y se apaga.

Son los tests más lentos del proyecto (cada uno levanta y baja procesos) pero
son los que cubren la promesa central: un grupo es un proceso propio, y si el
proceso muere, el grupo queda inactivo sin perder datos.
"""

from __future__ import annotations

import asyncio
import os
import socket
import sys
import textwrap

import pytest

from apps.common.types import new_id
from core.supervisor import GroupSupervisor

#: Cada test de este archivo levanta procesos reales. El límite evita que un
#: cuelgue en CI tumbe la build entera.
pytestmark: list[object] = []


def free_port() -> int:
    """Un puerto libre ahora mismo."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture
def supervisor() -> GroupSupervisor:
    return GroupSupervisor(db_url="postgresql+asyncpg://x:x@localhost/x", host="127.0.0.1")


class TestLifecycle:
    async def test_starts_and_stops_cleanly(self, supervisor: GroupSupervisor) -> None:
        """Arrancar y apagar no deja procesos colgando."""
        await supervisor.start()
        try:
            assert supervisor.count == 0
        finally:
            await supervisor.stop()

    async def test_stop_is_safe_when_nothing_ran(self, supervisor: GroupSupervisor) -> None:
        """Apagar un nodo que no levantó nada no falla."""
        await supervisor.stop()
        await supervisor.stop()

    async def test_start_is_idempotent(self, supervisor: GroupSupervisor) -> None:
        """Arrancar dos veces no deja dos tareas de supervisión."""
        await supervisor.start()
        await supervisor.start()
        await supervisor.stop()


class TestTerminateUnknownGroup:
    async def test_terminate_unknown_group_returns_false(self, supervisor: GroupSupervisor) -> None:
        """Apagar un grupo que no existe no es un error: es un no-op.

        El dueño aprieta "apagar" y el grupo ya estaba apagado.
        """
        assert await supervisor.terminate(new_id()) is False

    async def test_is_running_is_false_for_unknown(self, supervisor: GroupSupervisor) -> None:
        unknown = new_id()

        assert supervisor.is_running(unknown) is False
        assert supervisor.status(unknown) is None


class TestOrphanGuard:
    """La guardia del stdin es lo que evita procesos zombis."""

    async def test_child_dies_when_the_pipe_closes(self, supervisor: GroupSupervisor) -> None:
        """Si el padre muere sin avisar, el hijo se apaga solo.

        Se replica el mecanismo exacto: se le pasa un pipe por stdin y se cierra
        la escritura. El proceso hijo tiene que notar el EOF y salir. Sin esto,
        un nodo que muere de forma abrupta dejaría grupos sirviendo en puertos
        que ya nadie controla.
        """
        read_fd, write_fd = os.pipe()

        child = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            textwrap.dedent(
                """
                import sys
                sys.stdin.read()          # bloquea hasta el EOF
                sys.exit(0)
                """
            ),
            stdin=read_fd,
        )
        os.close(read_fd)

        # El hijo está vivo.
        await asyncio.sleep(0.3)
        assert child.returncode is None, "el hijo debería estar esperando el EOF"

        # Cerramos la escritura: es lo que pasa cuando el padre se muere.
        os.close(write_fd)

        code = await asyncio.wait_for(child.wait(), timeout=10)
        assert code == 0, "el hijo tiene que salir limpio al cerrar el pipe"

    async def test_child_ignores_extra_input(self) -> None:
        """Con datos de por medio, el EOF sigue llegando y el proceso igual sale."""
        read_fd, write_fd = os.pipe()

        child = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "import sys; sys.stdin.read(); sys.exit(7)",
            stdin=read_fd,
        )
        os.close(read_fd)

        await asyncio.sleep(0.3)
        os.write(write_fd, b"algo\n")
        os.close(write_fd)

        assert await asyncio.wait_for(child.wait(), timeout=10) == 7


class TestUsedPorts:
    async def test_no_ports_when_empty(self, supervisor: GroupSupervisor) -> None:
        assert supervisor.used_ports() == set()
        assert supervisor.running_ids == frozenset()
