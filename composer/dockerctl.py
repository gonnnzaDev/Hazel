"""Envoltorio fino alrededor del CLI de Docker.

No usamos ``docker compose``: el composer define los servicios, los volúmenes y
las redes directamente con ``docker run``. Por eso Python es el único composer.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field


class DockerError(RuntimeError):
    pass


def available() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(
        ["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False
    ).returncode == 0


def _run(args: list[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(args, text=True, capture_output=capture, check=False)
    if check and proc.returncode != 0:
        raise DockerError((proc.stderr or proc.stdout or " ".join(args)).strip())
    return proc


@dataclass
class Service:
    """Definición declarativa de un contenedor, en lugar de un compose.yml."""

    name: str
    image: str
    ports: list[str] = field(default_factory=list)
    environment: dict[str, str] = field(default_factory=dict)
    volumes: list[str] = field(default_factory=list)
    network: str = "hazel"
    healthcheck: list[str] | None = None
    restart: str = "unless-stopped"
    command: list[str] | None = None

    def exists(self) -> bool:
        return _run(["docker", "container", "inspect", self.name], check=False).returncode == 0

    def running(self) -> bool:
        proc = _run(
            ["docker", "inspect", "--format", "{{.State.Running}}", self.name], check=False
        )
        return proc.returncode == 0 and proc.stdout.strip() == "true"

    def health(self) -> str:
        proc = _run(
            ["docker", "inspect", "--format",
             "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", self.name],
            check=False,
        )
        return proc.stdout.strip() if proc.returncode == 0 else "missing"

    def start(self) -> None:
        if self.running():
            return
        if self.exists():
            _run(["docker", "start", self.name])
            return

        ensure_network(self.network)
        # Imagen fijada por digest: `docker run` la descarga. La del nodo es local.
        if not self.image.startswith("hazel:"):
            _run(["docker", "pull", self.image], check=False)

        args = ["docker", "run", "-d", "--name", self.name, "--network", self.network,
                "--restart", self.restart]
        for port in self.ports:
            args += ["-p", port]
        for volume in self.volumes:
            args += ["-v", volume]
        for key, value in self.environment.items():
            args += ["-e", f"{key}={value}"]
        if self.healthcheck:
            args += ["--health-cmd", self.healthcheck[0],
                     "--health-interval", self.healthcheck[1],
                     "--health-timeout", self.healthcheck[2],
                     "--health-retries", self.healthcheck[3]]
        args.append(self.image)
        if self.command:
            args += self.command
        _run(args)

    def stop(self) -> None:
        if self.exists():
            _run(["docker", "stop", self.name], check=False)

    def remove(self, *, volumes: bool = False) -> None:
        if self.exists():
            _run(["docker", "rm", "-f", self.name], check=False)
        if volumes:
            for volume in self.volumes:
                target = volume.split(":", 1)[0]
                if target and not target.startswith("/") and not target.startswith("."):
                    _run(["docker", "volume", "rm", "-f", target], check=False)

    def logs(self, follow: bool = False) -> int:
        if not self.exists():
            raise DockerError(f"el contenedor {self.name} no existe")
        args = ["docker", "logs"]
        if follow:
            args.append("-f")
        args.append(self.name)
        return subprocess.run(args, check=False).returncode

    def exec(self, command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        if not self.running():
            raise DockerError(f"el contenedor {self.name} no está corriendo")
        return _run(["docker", "exec", self.name, *command], check=check)

    def wait(self, *, timeout: int = 90) -> bool:
        """Espera a que el contenedor esté corriendo y, si aplica, healthy."""
        import time

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not self.running():
                time.sleep(0.5)
                continue
            state = self.health()
            if state in ("healthy", "none"):
                return True
            if state == "unhealthy":
                return False
            time.sleep(0.5)
        return False


def ensure_network(name: str) -> None:
    if _run(["docker", "network", "inspect", name], check=False).returncode != 0:
        _run(["docker", "network", "create", name], check=False)


def inspect_all() -> list[dict[str, str]]:
    """Estado resumido de los contenedores que empiezan con ``hazel-``."""
    fmt = "{{.Names}}\t{{.Status}}\t{{.Image}}"
    proc = _run(
        ["docker", "ps", "-a", "--filter", "name=hazel-", "--format", fmt], check=False
    )
    rows = []
    for line in proc.stdout.splitlines():
        name, status, image = (line.split("\t") + ["", "", ""])[:3]
        rows.append({"name": name, "status": status, "image": image})
    return rows


def stop_all() -> list[str]:
    """Parar todos los contenedores de Hazel; devuelve los que estaban activos."""
    stopped: list[str] = []
    for row in inspect_all():
        if not row["status"].startswith("Up"):
            continue
        name = row["name"]
        _run(["docker", "stop", name], check=False)
        stopped.append(name)
    return stopped
