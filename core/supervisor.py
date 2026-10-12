"""Supervisor de grupos: un proceso por grupo.

## La forma

```
  dueño corre:  recap-node                        ← proceso del nodo, puerto 7272
                  │
                  ├── recap-group --server-id=A --port=7273
                  ├── recap-group --server-id=B --port=7274
                  └── recap-group --server-id=C --port=7275
```

El proceso del nodo es el plano de control: el dueño lo abre, ve sus grupos,
crea y apaga. Cada grupo corre en un proceso aparte, con su puerto, y ahí pasan
las cosas.

## Por qué procesos y no un solo proceso con N grupos

Un grupo que se cuelga —un mensaje malformado, una fuga de memoria, un
deadlock— se lleva por delante el proceso. Con un proceso solo, eso tumba todos
los grupos del dueño. Con un proceso por grupo, solo cae ese grupo, y el dueño
lo vuelve a levantar sin perder los otros.

Es el mismo criterio por el que una base de datos no corre todas las tablas en
un proceso: el aislamiento se paga con complejidad, y acá el aislamiento vale
porque los datos de una persona están en su máquina y no puede pedirle a nadie
que los reinicie.

## Cómo muere un grupo huérfano

Cuando el proceso del nodo muere, sus hijos quedan huérfanos en Unix: siguen
corriendo sin nadie que los supervise.

La solución acá es `stdin`: el nodo no le pasa la terminal al hijo, sino la
extremo de escritura de un pipe. Cuando el nodo muere, el pipe se cierra, el hijo
lee EOF en stdin y se apaga solo. No hay archivos de pid, ni señales cruzadas,
ni basura acumulada si el nodo muere de forma abrupta.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from apps.common.types import RecordId

logger = logging.getLogger(__name__)

#: Cuánto se le da a un grupo para apagarse antes de matarlo a la fuerza.
#:
#: El proceso recibe SIGTERM, Uvicorn cierra las conexiones WebSocket y sale
#: limpio. Si en ese tiempo no terminó, se le manda SIGKILL: es preferible
#: un grupo muerto a un proceso zombi ocupando un puerto.
GRACEFUL_SHUTDOWN_SECONDS = 10.0

#: Cada cuánto se mira si algún proceso se murió sin que nos enteremos.
SUPERVISE_INTERVAL_SECONDS = 2.0


@dataclass(slots=True)
class GroupProcess:
    """Un proceso de grupo y todo lo que hay que saber de él."""

    server_id: RecordId
    port: int
    process: asyncio.subprocess.Process
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def pid(self) -> int | None:
        return self.process.pid

    @property
    def returncode(self) -> int | None:
        """Código de salida, o `None` si sigue vivo."""
        return self.process.returncode

    @property
    def is_running(self) -> bool:
        return self.process.returncode is None

    @property
    def uptime_seconds(self) -> float:
        return (datetime.now(UTC) - self.started_at).total_seconds()


class GroupSupervisor:
    """Levanta, baja y vigila los procesos de los grupos de este nodo."""

    def __init__(self, *, db_url: str, host: str = "0.0.0.0") -> None:  # noqa: S104
        self._db_url = db_url
        self._host = host
        self._groups: dict[RecordId, GroupProcess] = {}
        self._shutdown = asyncio.Event()
        self._supervisor_task: asyncio.Task[None] | None = None

    # ─── Ciclo de vida ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Empieza a vigilar los procesos. Idempotente."""
        if self._supervisor_task is not None and not self._supervisor_task.done():
            return

        self._shutdown.clear()
        self._supervisor_task = asyncio.create_task(self._supervise_loop(), name="group-supervisor")
        logger.info("supervisor de grupos iniciado")

    async def stop(self) -> None:
        """Apaga todos los grupos y deja de vigilar.

        Se llama en el shutdown del nodo. Los grupos quedan marcados como
        inactivos en la base por el reconciliador, igual que si el nodo se
        hubiera caído.
        """
        self._shutdown.set()

        if self._supervisor_task is not None:
            self._supervisor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._supervisor_task
            self._supervisor_task = None

        await asyncio.gather(*(self._terminate(g) for g in list(self._groups.values())))
        self._groups.clear()
        logger.info("supervisor de grupos detenido")

    # ─── Operar grupos ─────────────────────────────────────────────────────────

    async def spawn(self, server_id: RecordId, port: int) -> GroupProcess:
        """Levanta el proceso de un grupo.

        Si el grupo ya tiene un proceso vivo, lo devuelve tal cual: pedir que
        levante un grupo que ya está arriba es un no-op, no un error. Es lo que
        espera la gente cuando aprieta un botón.
        """
        existing = self._groups.get(server_id)
        if existing is not None and existing.is_running:
            logger.info("el grupo %s ya tiene un proceso vivo (pid %s)", server_id, existing.pid)
            return existing

        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "core",
            "group",
            f"--server-id={server_id}",
            f"--port={port}",
            f"--host={self._host}",
            # El pipe de guardia: si el nodo muere, el hijo lee EOF y se apaga.
            stdin=asyncio.subprocess.PIPE,
            env=self._child_env(),
            cwd=os.getcwd(),
        )

        group = GroupProcess(server_id=server_id, port=port, process=process)
        self._groups[server_id] = group

        logger.info("grupo %s levantado en el puerto %s (pid %s)", server_id, port, process.pid)
        return group

    async def terminate(self, server_id: RecordId) -> bool:
        """Apaga el proceso de un grupo. Devuelve si había algo que apagar."""
        group = self._groups.get(server_id)
        if group is None:
            return False

        await self._terminate(group)
        del self._groups[server_id]
        return True

    async def restart(self, server_id: RecordId, port: int) -> GroupProcess:
        """Reaparece un grupo en un puerto (posiblemente nuevo)."""
        await self.terminate(server_id)
        return await self.spawn(server_id, port)

    async def wait_ready(self, server_id: RecordId, timeout_seconds: float = 10.0) -> bool:
        """Espera a que el grupo responda su propio `/health`.

        Devolver apenas el proceso arrancó no sirve: el dueño comparte el puerto
        con alguien y este todavía no escucha. Se espera a que esté de verdad.
        """
        group = self._groups.get(server_id)
        if group is None:
            return False

        deadline = asyncio.get_running_loop().time() + timeout_seconds
        url = f"http://127.0.0.1:{group.port}/health"

        while asyncio.get_running_loop().time() < deadline:
            if not group.is_running:
                logger.error(
                    "el grupo %s se murió antes de estar listo (código %s)",
                    server_id,
                    group.returncode,
                )
                return False
            if await self._probe(url):
                return True
            await asyncio.sleep(0.2)

        logger.warning("el grupo %s no respondió en %ss", server_id, timeout_seconds)
        return False

    # ─── Estado ────────────────────────────────────────────────────────────────

    def is_running(self, server_id: RecordId) -> bool:
        group = self._groups.get(server_id)
        return group is not None and group.is_running

    def status(self, server_id: RecordId) -> GroupProcess | None:
        return self._groups.get(server_id)

    @property
    def running_ids(self) -> frozenset[RecordId]:
        """Ids de los grupos con proceso vivo."""
        return frozenset(sid for sid, g in self._groups.items() if g.is_running)

    def used_ports(self) -> set[int]:
        """Puertos que este nodo tiene ocupados con grupos."""
        return {g.port for g in self._groups.values()}

    @property
    def count(self) -> int:
        return len(self._groups)

    # ─── Interno ───────────────────────────────────────────────────────────────

    def _child_env(self) -> dict[str, str]:
        """Entorno del proceso hijo.

        Se heredan las variables del padre (`.env` ya se resolvió) y se agrega
        una marca para que el hijo sepa que es un grupo y no el nodo.
        """
        env = dict(os.environ)
        env["RECOP_ROLE"] = "group"
        env["PYTHONUNBUFFERED"] = "1"
        return env

    async def _terminate(self, group: GroupProcess) -> None:
        """Apaga un proceso de grupo: SIGTERM, esperar, SIGKILL."""
        if not group.is_running:
            return

        logger.info("apagando el grupo %s (pid %s)", group.server_id, group.pid)
        with contextlib.suppress(ProcessLookupError, PermissionError):
            group.process.terminate()

        try:
            await asyncio.wait_for(group.process.wait(), timeout=GRACEFUL_SHUTDOWN_SECONDS)
        except TimeoutError:
            logger.warning(
                "el grupo %s no cerró en %ss, lo mato",
                group.server_id,
                GRACEFUL_SHUTDOWN_SECONDS,
            )
            with contextlib.suppress(ProcessLookupError, PermissionError):
                group.process.kill()
            with contextlib.suppress(ProcessLookupError):
                await group.process.wait()

    async def _supervise_loop(self) -> None:
        """Mira periódicamente que los grupos sigan vivos.

        Un grupo que se muere solo tiene que quedar marcado como inactivo: la
        base se entera por el reconciliador, y el dueño lo ve apagado sin que
        nadie tenga que hacerlo a mano.
        """
        while not self._shutdown.is_set():
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._shutdown.wait(), timeout=SUPERVISE_INTERVAL_SECONDS)

            for server_id, group in list(self._groups.items()):
                if group.is_running:
                    continue

                logger.warning(
                    "el grupo %s se murió solo (código %s). "
                    "Queda inactivo hasta que el dueño lo vuelva a encender.",
                    server_id,
                    group.returncode,
                )
                del self._groups[server_id]

    @staticmethod
    async def _probe(url: str) -> bool:
        """Si una URL responde. Sin dependencias: urllib y asyncio.

        `urlopen` es bloqueante, así que va en un hilo. Con un timeout corto
        porque es un health check en loop, no una request de negocio.
        """
        import urllib.error
        import urllib.request

        loop = asyncio.get_running_loop()

        def _check() -> bool:
            try:
                with urllib.request.urlopen(url, timeout=1) as response:  # noqa: S310
                    return bool(response.status == 200)
            except (urllib.error.URLError, OSError, ValueError):
                return False

        result: bool = await loop.run_in_executor(None, _check)
        return result


async def install_signal_handlers(on_shutdown: Callable[[], Any]) -> None:
    """SIGTERM y SIGINT llaman `on_shutdown`.

    Sin esto, `docker stop` mata el proceso sin avisarle a los grupos hijos, y
    quedan zombis ocupando puertos.

    `add_signal_handler` solo acepta funciones síncronas: si se le pasa la
    corrutina directamente, el proceso muere al arrancar con
    `TypeError: coroutines cannot be used with add_signal_handler()`. Por eso
    se envuelve en `create_task`.
    """
    loop = asyncio.get_running_loop()

    def _fire() -> None:
        task = loop.create_task(on_shutdown())
        # Se guarda la referencia para que el garbage collector no la mate a
        # mitad de camino.
        _PENDING_SHUTDOWNS.add(task)
        task.add_done_callback(_PENDING_SHUTDOWNS.discard)

    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):  # no existe en Windows
            loop.add_signal_handler(sig, _fire)


#: Tasks de apagado en vuelo. Sin esto, Python puede recolectar una task que
#: todavía no arrancó y el apagado se pierde a mitad de camino.
_PENDING_SHUTDOWNS: set[asyncio.Task[None]] = set()
