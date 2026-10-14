"""One process per group for fault isolation.

Children get a pipe as stdin; node death closes it so orphans read EOF and exit.
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

#: Grace period for SIGTERM before SIGKILL; avoids zombie port-holders.
GRACEFUL_SHUTDOWN_SECONDS = 10.0

#: Reap check interval for silently died children.
SUPERVISE_INTERVAL_SECONDS = 2.0


@dataclass(slots=True)
class GroupProcess:
    """A group child process and its metadata."""

    server_id: RecordId
    port: int
    process: asyncio.subprocess.Process
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def pid(self) -> int | None:
        return self.process.pid

    @property
    def returncode(self) -> int | None:
        """Exit code, or None while alive."""
        return self.process.returncode

    @property
    def is_running(self) -> bool:
        return self.process.returncode is None

    @property
    def uptime_seconds(self) -> float:
        return (datetime.now(UTC) - self.started_at).total_seconds()


class GroupSupervisor:
    """Spawns, stops, and watches this node's group processes."""

    def __init__(self, *, db_url: str, host: str = "0.0.0.0") -> None:  # noqa: S104
        self._db_url = db_url
        self._host = host
        self._groups: dict[RecordId, GroupProcess] = {}
        self._shutdown = asyncio.Event()
        self._supervisor_task: asyncio.Task[None] | None = None

    # ─── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start watching; idempotent."""
        if self._supervisor_task is not None and not self._supervisor_task.done():
            return

        self._shutdown.clear()
        self._supervisor_task = asyncio.create_task(self._supervise_loop(), name="group-supervisor")
        logger.info("supervisor de grupos iniciado")

    async def stop(self) -> None:
        """Stop watching and terminate all groups; reconciler marks them inactive."""
        self._shutdown.set()

        if self._supervisor_task is not None:
            self._supervisor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._supervisor_task
            self._supervisor_task = None

        await asyncio.gather(*(self._terminate(g) for g in list(self._groups.values())))
        self._groups.clear()
        logger.info("supervisor de grupos detenido")

    # ─── Group ops ─────────────────────────────────────────────────────────

    async def spawn(self, server_id: RecordId, port: int) -> GroupProcess:
        """Spawn a group process; returns the live one if already running."""
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
            # Guard pipe: node death delivers EOF so the child exits.
            stdin=asyncio.subprocess.PIPE,
            env=self._child_env(),
            cwd=os.getcwd(),
        )

        group = GroupProcess(server_id=server_id, port=port, process=process)
        self._groups[server_id] = group

        logger.info("grupo %s levantado en el puerto %s (pid %s)", server_id, port, process.pid)
        return group

    async def terminate(self, server_id: RecordId) -> bool:
        """Terminate a group process; True when one existed."""
        group = self._groups.get(server_id)
        if group is None:
            return False

        await self._terminate(group)
        del self._groups[server_id]
        return True

    async def restart(self, server_id: RecordId, port: int) -> GroupProcess:
        """Restart a group on the given (possibly new) port."""
        await self.terminate(server_id)
        return await self.spawn(server_id, port)

    async def wait_ready(self, server_id: RecordId, timeout_seconds: float = 10.0) -> bool:
        """Wait until the group answers its own /health."""
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

    # ─── State ────────────────────────────────────────────────────────────────

    def is_running(self, server_id: RecordId) -> bool:
        group = self._groups.get(server_id)
        return group is not None and group.is_running

    def status(self, server_id: RecordId) -> GroupProcess | None:
        return self._groups.get(server_id)

    @property
    def running_ids(self) -> frozenset[RecordId]:
        """Ids of groups with a live process."""
        return frozenset(sid for sid, g in self._groups.items() if g.is_running)

    def used_ports(self) -> set[int]:
        """Ports this node holds for groups."""
        return {g.port for g in self._groups.values()}

    @property
    def count(self) -> int:
        return len(self._groups)

    # ─── Internals ───────────────────────────────────────────────────────────────

    def _child_env(self) -> dict[str, str]:
        """Child env: inherit parent plus group role marker."""
        env = dict(os.environ)
        env["RECOP_ROLE"] = "group"
        env["PYTHONUNBUFFERED"] = "1"
        return env

    async def _terminate(self, group: GroupProcess) -> None:
        """SIGTERM, wait, then SIGKILL."""
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
        """Reap dead groups; they stay inactive until re-enabled."""
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
        """Blocking urlopen in a thread with short timeout; no extra deps."""
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
    """Route SIGTERM/SIGINT to on_shutdown."""
    loop = asyncio.get_running_loop()

    def _fire() -> None:
        # add_signal_handler needs sync funcs; wrap the coroutine in a task.
        task = loop.create_task(on_shutdown())
        # Keep a ref so GC never drops a pending shutdown.
        _PENDING_SHUTDOWNS.add(task)
        task.add_done_callback(_PENDING_SHUTDOWNS.discard)

    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):  # Unavailable on Windows.
            loop.add_signal_handler(sig, _fire)


#: In-flight shutdown tasks; prevents GC from dropping them early.
_PENDING_SHUTDOWNS: set[asyncio.Task[None]] = set()
