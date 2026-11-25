"""Punto de entrada de ``python -m composer``.

Un solo orquestador, escrito en Python estándar, que reemplaza a
``docker compose``, al ``Makefile`` y a los scripts ``.sh``/``.ps1``.
La aplicación es Rust; Python solo compone.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import __version__, dockerctl, env
from .dockerctl import DockerError, Service

ROOT = env.ROOT
RUST_DIR = env.RUST_DIR
BINARY = env.BINARY
SQL_DIR = ROOT / "migrations" / "sql"

POSTGRES_IMAGE = "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
KAFKA_IMAGE = "apache/kafka:3.9.1@sha256:4ceccc577f03f51f6af8dbfda55194d0d892f4fa7913ffbded567ce3895622ed"
NODE_IMAGE = "hazel:0.1.0"

KAFKA_ENV = {
    "CLUSTER_ID": "MkU3OEVBNTcwNTJENDM2Qk",
    "KAFKA_NODE_ID": "1",
    "KAFKA_PROCESS_ROLES": "broker,controller",
    "KAFKA_LISTENERS": "PLAINTEXT://:19092,PLAINTEXT_HOST://:9092,CONTROLLER://:29093",
    "KAFKA_ADVERTISED_LISTENERS": "PLAINTEXT://kafka:19092,PLAINTEXT_HOST://localhost:9092",
    "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP": "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
    "KAFKA_CONTROLLER_LISTENER_NAMES": "CONTROLLER",
    "KAFKA_INTER_BROKER_LISTENER_NAME": "PLAINTEXT",
    "KAFKA_CONTROLLER_QUORUM_VOTERS": "1@kafka:29093",
    "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR": "1",
    "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR": "1",
    "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR": "1",
    "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS": "0",
    "KAFKA_LOG_DIRS": "/var/lib/kafka/data",
}

OK = "\033[32m✓\033[0m"
INFO = "\033[36m==>\033[0m"
WARN = "\033[33m!\033[0m"
ERR = "\033[31merror:\033[0m"


def say(message: str) -> None:
    print(f"{INFO} {message}", flush=True)


def ok(message: str) -> None:
    print(f"  {OK} {message}", flush=True)


def warn(message: str) -> None:
    print(f"  {WARN} {message}", file=sys.stderr, flush=True)


def die(message: str, code: int = 1) -> None:
    print(f"{ERR} {message}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def run(args: list[str], *, cwd: Path | None = None, check: bool = True,
        quiet: bool = False, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    if not quiet:
        say(" ".join(args))
    process_env = {**os.environ, **(extra_env or {})}
    proc = subprocess.run(args, cwd=cwd, env=process_env, text=True, check=False,
                          stdout=subprocess.PIPE if quiet else None,
                          stderr=subprocess.PIPE if quiet else None)
    if check and proc.returncode != 0:
        detail = ((proc.stderr or "") + (proc.stdout or "")).strip() if quiet else ""
        die(f"comando fallido ({proc.returncode}): {' '.join(args)}\n{detail}".rstrip())
    return proc


def cargo_env() -> dict[str, str]:
    """rdkafka compila librdkafka con cmake: elegimos el generador disponible."""
    if shutil.which("make"):
        return {}
    if shutil.which("ninja"):
        return {"CMAKE_GENERATOR": "Ninja"}
    if not shutil.which("cmake"):
        warn("ni make ni ninja: rdkafka podría fallar al compilar")
    return {}


# ─── Definición de servicios (antes, docker-compose*.yml) ────────────────────

def services(values: dict[str, str], profile: str) -> dict[str, Service]:
    suffix = "-dev" if profile == "dev" else ""
    user = env.get(values, "POSTGRES_USER", "hazel")
    password = env.get(values, "POSTGRES_PASSWORD", "hazel")
    database = env.get(values, "POSTGRES_DB", "hazel")

    postgres = Service(
        name=f"hazel-postgres{suffix}",
        image=POSTGRES_IMAGE,
        ports=[f"{env.get(values, 'POSTGRES_PORT', '5432')}:5432"],
        environment={"POSTGRES_USER": user, "POSTGRES_PASSWORD": password, "POSTGRES_DB": database},
        volumes=[f"hazel-postgres-data{suffix}:/var/lib/postgresql/data"],
        healthcheck=[f"pg_isready -U {user} -d {database}", "5s", "5s", "10"],
    )
    kafka = Service(
        name=f"hazel-kafka{suffix}",
        image=KAFKA_IMAGE,
        ports=[f"{env.get(values, 'KAFKA_EXTERNAL_PORT', '9092')}:9092"],
        environment=KAFKA_ENV,
        volumes=[f"hazel-kafka-data{suffix}:/var/lib/kafka/data"],
    )
    result = {"postgres": postgres, "kafka": kafka}

    if profile == "full":
        port_end = env.get(values, "HAZEL_GROUP_PORT_END", "7400")
        result["api"] = Service(
            name="hazel-api",
            image=NODE_IMAGE,
            ports=[
                f"{env.get(values, 'HAZEL_PUBLISH_HOST', '0.0.0.0')}:"
                f"{env.get(values, 'HAZEL_PUBLISH_PORT', '7272')}:7272",
                f"7273-{port_end}:7273-{port_end}",
            ],
            environment={
                "HAZEL_ENV": "prod",
                "HAZEL_SECRET_KEY": env.get(values, "HAZEL_SECRET_KEY"),
                "HAZEL_ADMIN_TOKEN": env.get(values, "HAZEL_ADMIN_TOKEN"),
                "HAZEL_HOST": "0.0.0.0",
                "HAZEL_PORT": "7272",
                "HAZEL_GROUP_PORT_END": port_end,
                "HAZEL_DATABASE_URL": env.database_url(values, "postgres"),
                "HAZEL_KAFKA_BOOTSTRAP_SERVERS": "kafka:19092",
                "HAZEL_STORAGE_ROOT": "/data/hazel",
                "RUST_LOG": "info",
            },
            volumes=["hazel-node-data:/data/hazel"],
        )
    return result


def require_docker() -> None:
    if not dockerctl.available():
        die("Docker no está disponible o el daemon no responde")


# ─── Comandos ────────────────────────────────────────────────────────────────

def cmd_setup(args: argparse.Namespace) -> None:
    say("Comprobando herramientas")
    for tool in ("python3", "cargo"):
        if shutil.which(tool) is None:
            die(f"falta {tool}")
        ok(tool)
    if dockerctl.available():
        ok("docker")
    else:
        warn("docker no disponible: los servicios deberán estar en otra máquina")

    created = env.create_env(force=args.force_env)
    ok(".env creado con secretos nuevos" if created else ".env ya existe (sin cambios)")

    cmd_build(args)
    if dockerctl.available():
        cmd_up(argparse.Namespace(profile="dev"))
    else:
        warn("arranque de servicios omitido (sin Docker)")

    say("Listo")
    print("\n  Arranca el nodo con:  python -m composer api")
    print("  Documentación:        http://localhost:7272/docs\n")


def cmd_build(args: argparse.Namespace) -> None:
    if not (RUST_DIR / "Cargo.toml").exists():
        die(f"no se encontró {RUST_DIR / 'Cargo.toml'}")
    run(["cargo", "build", "--release"], cwd=RUST_DIR, extra_env=cargo_env())
    ok(f"binario compilado en {BINARY}")


def cmd_up(args: argparse.Namespace) -> None:
    values = env.read_env()
    want_api = args.profile == "full"
    if args.profile == "full" and not dockerctl.available():
        die("el perfil full necesita Docker para el contenedor del nodo")

    stack = services(values, "full" if want_api else "dev")
    if want_api:
        run(["docker", "build", "-t", NODE_IMAGE, "-f", "Dockerfile", "."], cwd=ROOT)
    for name, service in stack.items():
        say(f"Arrancando {name} ({service.name})")
        try:
            service.start()
        except DockerError as exc:
            die(f"no se pudo arrancar {name}: {exc}")
        if not service.wait():
            die(f"{name} no respondió a tiempo; revisa `python -m composer logs {name}`")
        ok(f"{name} listo")

    if not dockerctl.available():
        return
    say("Aplicando migraciones")
    migrate_schema(values, stack["postgres"])
    print(f"\n  Nodo:  http://localhost:{env.get(values, 'HAZEL_PORT', '7272')}/health")


def cmd_down(args: argparse.Namespace) -> None:
    require_docker()
    profiles = ("dev", "full") if args.all else (args.profile,)
    for profile in profiles:
        for service in services(env.read_env(), profile).values():
            if service.exists():
                say(f"Parando {service.name}")
                service.stop()


def cmd_reset(args: argparse.Namespace) -> None:
    require_docker()
    for profile in ("dev", "full"):
        for name, service in services(env.read_env(), profile).items():
            if name == "kafka":
                continue
            say(f"Eliminando {service.name} y su volumen")
            service.remove(volumes=True)
    ok("servicios y volúmenes eliminados")


def cmd_restart(args: argparse.Namespace) -> None:
    cmd_down(argparse.Namespace(profile=args.profile, all=args.all))
    cmd_up(argparse.Namespace(profile=args.profile))


def cmd_logs(args: argparse.Namespace) -> None:
    require_docker()
    stack = services(env.read_env(), "full")
    if args.service:
        service = stack.get(args.service)
        if service is None:
            die(f"servicio desconocido: {args.service}")
        raise SystemExit(service.logs(follow=args.follow))
    for service in stack.values():
        if service.exists():
            print(f"\n==> {service.name}")
            service.logs(follow=False)


def cmd_ps(args: argparse.Namespace) -> None:
    require_docker()
    rows = dockerctl.inspect_all()
    if not rows:
        print("No hay contenedores de Hazel.")
        return
    print(f"{'CONTENEDOR':<24} {'ESTADO':<28} IMAGEN")
    for row in rows:
        print(f"{row['name']:<24} {row['status']:<28} {row['image']}")


# ─── Ciclo de vida del nodo en primer plano ──────────────────────────────────

NODE_SHUTDOWN_TIMEOUT = 15.0


def _signal_node(proc: subprocess.Popen[str], sig: int) -> None:
    """Enviar la señal al nodo y a los procesos grupo que él lanzó.

    El nodo se arranca con ``start_new_session=True``: su pgid es su pid, así
    que ``killpg`` alcanza también a los hijos que el supervisor haya creado.
    """
    if os.name == "posix":
        try:
            os.killpg(proc.pid, sig)
            return
        except (ProcessLookupError, PermissionError):
            pass
    try:
        proc.send_signal(sig)
    except (ProcessLookupError, OSError, ValueError):
        pass


def _wait_node(proc: subprocess.Popen[str], timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return True
        time.sleep(0.1)
    return proc.poll() is not None


def _stop_node(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is None:
        say("Apagando el nodo y sus procesos grupo")
        _signal_node(proc, signal.SIGTERM)
        if not _wait_node(proc, NODE_SHUTDOWN_TIMEOUT):
            warn("el nodo no respondió a SIGTERM; forzando SIGKILL")
            _signal_node(proc, signal.SIGKILL)
            _wait_node(proc, 5.0)
    elif os.name == "posix":
        # El nodo ya salió, pero un crash puede dejar procesos grupo huérfanos.
        _signal_node(proc, signal.SIGTERM)


def _stop_background_services(args: argparse.Namespace) -> None:
    if getattr(args, "keep_services", False):
        warn("servicios en segundo plano conservados (--keep-services)")
        return
    if not dockerctl.available():
        return
    try:
        stopped = dockerctl.stop_all()
    except DockerError as exc:
        warn(f"no se pudieron parar los servicios en segundo plano: {exc}")
        return
    for name in stopped:
        say(f"Parando {name}")


def cmd_api(args: argparse.Namespace) -> None:
    values = env.read_env()
    if not values.get("HAZEL_SECRET_KEY"):
        die("falta HAZEL_SECRET_KEY; ejecuta `python -m composer setup`")
    if not BINARY.exists():
        say("El binario no existe; compilando")
        cmd_build(args)
    host = args.host or env.get(values, "HAZEL_HOST", "0.0.0.0")
    port = args.port or int(env.get(values, "HAZEL_PORT", "7272"))
    command = [str(BINARY), "node", f"--host={host}", f"--port={port}"]
    say(" ".join(command))
    try:
        proc = subprocess.Popen(
            command,
            cwd=ROOT,
            env=env.rust_env(values, "localhost", port),
            start_new_session=(os.name == "posix"),
        )
    except OSError as exc:
        die(f"no se pudo arrancar el nodo: {exc}")

    previous: dict[int, object] = {}

    def forward(signum: int, _frame: object) -> None:
        # El nodo ya hace shutdown graceful de grupos, Kafka y DB.
        _signal_node(proc, signum)

    if os.name == "posix":
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, forward)

    try:
        while proc.poll() is None:
            time.sleep(0.2)
        code = proc.returncode or 0
    except KeyboardInterrupt:
        _signal_node(proc, signal.SIGINT)
        _wait_node(proc, NODE_SHUTDOWN_TIMEOUT)
        code = proc.returncode or 130
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)  # type: ignore[arg-type]
        _stop_node(proc)
        _stop_background_services(args)

    raise SystemExit(code)


def cmd_migrate(args: argparse.Namespace) -> None:
    if not dockerctl.available():
        die("las migraciones necesitan el PostgreSQL del composer (Docker)")
    migrate_schema(env.read_env(), services(env.read_env(), "dev")["postgres"])


def migrate_schema(values: dict[str, str], postgres: Service) -> None:
    """Aplica las migraciones SQL en orden, con control de ya aplicadas."""
    if not SQL_DIR.exists():
        warn(f"no hay migraciones SQL en {SQL_DIR}")
        return
    user = env.get(values, "POSTGRES_USER", "hazel")
    database = env.get(values, "POSTGRES_DB", "hazel")
    base = ["psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1"]

    postgres.exec(["sh", "-c",
                   "CREATE TABLE IF NOT EXISTS _composer_migrations "
                   "(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"])
    applied = set(postgres.exec(
        ["psql", "-U", user, "-d", database, "-At", "-c",
         "SELECT name FROM _composer_migrations"], check=False
    ).stdout.splitlines())

    for path in sorted(SQL_DIR.glob("*.sql")):
        if path.name in applied:
            continue
        say(f"Migración {path.name}")
        result = subprocess.run(
            ["docker", "exec", "-i", postgres.name, *base, "-f", "-"],
            input=path.read_text(encoding="utf-8"), text=True, check=False,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            die(f"migración {path.name} falló:\n{result.stderr.strip()}")
        safe = path.name.replace("'", "''")
        postgres.exec(["psql", "-U", user, "-d", database, "-c",
                       f"INSERT INTO _composer_migrations (name) VALUES ('{safe}')"])
        ok(path.name)


def cmd_health(args: argparse.Namespace) -> None:
    values = env.read_env()
    port = args.port or int(env.get(values, "HAZEL_PORT", "7272"))
    for path in ("/health", "/health/ready"):
        url = f"http://localhost:{port}{path}"
        try:
            with urllib.request.urlopen(url, timeout=4) as response:
                print(f"{path}: {response.status} {response.read().decode('utf-8', 'replace')}")
        except urllib.error.HTTPError as exc:
            print(f"{path}: {exc.code} {exc.read().decode('utf-8', 'replace')}")
        except urllib.error.URLError as exc:
            die(f"el nodo no responde en {url}: {exc.reason}")


def cmd_check(args: argparse.Namespace) -> None:
    run(["cargo", "fmt", "--all", "--", "--check"], cwd=RUST_DIR, extra_env=cargo_env())
    run(["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], cwd=RUST_DIR,
        extra_env=cargo_env())
    run(["cargo", "test"], cwd=RUST_DIR)
    run([sys.executable, "-m", "compileall", "-q", "composer"], cwd=ROOT)
    ok("todo correcto")


def cmd_test(args: argparse.Namespace) -> None:
    run(["cargo", "test"], cwd=RUST_DIR)


def cmd_env(args: argparse.Namespace) -> None:
    if args.init:
        created = env.create_env(force=args.force)
        ok(".env creado" if created else ".env ya existe (usa --force para sobrescribir)")
        return
    if not env.ENV_FILE.exists():
        die("no hay .env; ejecuta `python -m composer setup`")
    for line in env.ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            if any(secret in key for secret in ("SECRET", "TOKEN", "PASSWORD")):
                value = "••••••••"
            print(f"{key}={value}")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m composer",
        description="Hazel: el único composer. Orquesta Rust, PostgreSQL y Kafka.",
    )
    p.add_argument("--version", action="version", version=f"hazel-composer {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    setup = sub.add_parser("setup", help="prepara .env, compila y arranca los servicios")
    setup.add_argument("--force-env", action="store_true", help="sobrescribe .env")
    setup.set_defaults(func=cmd_setup)

    sub.add_parser("build", help="compila el nodo Rust en modo release").set_defaults(func=cmd_build)

    up = sub.add_parser("up", help="arranca los servicios")
    up.add_argument("profile", nargs="?", choices=("dev", "full"), default="dev",
                    help="dev: PostgreSQL + Kafka; full: también el nodo en contenedor")
    up.set_defaults(func=cmd_up)

    down = sub.add_parser("down", help="para los servicios (sin borrar datos)")
    down.add_argument("profile", nargs="?", choices=("dev", "full"), default="dev")
    down.add_argument("--all", "-a", action="store_true", help="para todos los perfiles")
    down.set_defaults(func=cmd_down)

    sub.add_parser("reset", help="para los servicios y borra los volúmenes").set_defaults(func=cmd_reset)

    restart = sub.add_parser("restart", help="para y arranca los servicios")
    restart.add_argument("profile", nargs="?", choices=("dev", "full"), default="dev")
    restart.add_argument("--all", "-a", action="store_true")
    restart.set_defaults(func=cmd_restart)

    logs = sub.add_parser("logs", help="muestra los logs")
    logs.add_argument("service", nargs="?", choices=("postgres", "kafka", "api"))
    logs.add_argument("-f", "--follow", action="store_true")
    logs.set_defaults(func=cmd_logs)

    sub.add_parser("ps", help="estado de los contenedores").set_defaults(func=cmd_ps)

    api = sub.add_parser("api", help="ejecuta el nodo Rust en esta máquina")
    api.add_argument("--host")
    api.add_argument("--port", type=int)
    api.add_argument("--keep-services", action="store_true",
                     help="no parar PostgreSQL/Kafka cuando termine el nodo")
    api.set_defaults(func=cmd_api)

    sub.add_parser("migrate", help="aplica las migraciones SQL").set_defaults(func=cmd_migrate)

    health = sub.add_parser("health", help="consulta /health y /health/ready")
    health.add_argument("--port", type=int)
    health.set_defaults(func=cmd_health)

    sub.add_parser("check", help="fmt + clippy + tests + sintaxis").set_defaults(func=cmd_check)
    sub.add_parser("test", help="cargo test").set_defaults(func=cmd_test)

    envp = sub.add_parser("env", help="muestra la configuración (secretos ocultos)")
    envp.add_argument("--init", action="store_true", help="crea un .env nuevo")
    envp.add_argument("--force", action="store_true", help="sobrescribe el .env con --init")
    envp.set_defaults(func=cmd_env)
    return p


def main() -> None:
    args = parser().parse_args()
    try:
        args.func(args)
    except DockerError as exc:
        die(str(exc))
    except KeyboardInterrupt:
        print(file=sys.stderr)


if __name__ == "__main__":
    main()
