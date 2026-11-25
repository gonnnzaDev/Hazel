# Installation

Hazel necesita **Rust** para el nodo y **Python 3** solo para el composer.
No hay `uv`, `pyproject.toml` ni entorno virtual: el composer usa únicamente la
biblioteca estándar.

| Platform | Prerequisites |
|---|---|
| Linux | `git`, `python3`, `cargo`, Docker |
| macOS | `git`, `python3`, `cargo` (Xcode tools), Docker Desktop |
| Windows | Git for Windows, Python, Rust, Docker Desktop |
| Android (Termux) | `git`, `python`, `rust`, Docker |

## Install

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
python -m composer setup
```

`setup` es idempotente y hace, en orden:

1. Comprueba `python3`, `cargo` y Docker.
2. Crea `.env` con `HAZEL_SECRET_KEY` y `HAZEL_ADMIN_TOKEN` aleatorios.
3. Compila el nodo: `cargo build --release` en `rust/` → `rust/target/release/hazel`.
4. Arranca PostgreSQL y Kafka.
5. Aplica `migrations/sql/*.sql`.

## Everyday commands

```bash
python -m composer up          # PostgreSQL + Kafka
python -m composer api         # el nodo Rust en esta máquina
python -m composer up full     # todo en contenedores
python -m composer check       # fmt + clippy + tests + sintaxis del composer
python -m composer help        # todos los comandos
```

`composer api` se encarga de apagar todo al salir: grupos supervisados,
PostgreSQL y Kafka. Si necesitas conservar los servicios para otra sesión, usa
`python -m composer api --keep-services`. Los datos no se borran.

Si no tienes Docker, `setup` igual genera `.env` y compila el binario. Apunta
`HAZEL_DATABASE_URL` y `HAZEL_KAFKA_BOOTSTRAP_SERVERS` a tus propios servicios
y ejecuta `python -m composer migrate` cuando la base esté accesible.

## Verificar la instalación

```bash
python -m composer health
curl http://localhost:7272/health
```

El token de administración está en `.env` (`HAZEL_ADMIN_TOKEN`). Envíalo como
`Authorization: Bearer <token>` en los endpoints de gestión de servidores.

## Troubleshooting

**`cargo build` falla al compilar rdkafka** → instala `cmake`, `perl`,
`pkg-config` y `libssl-dev` (en Debian/Arch: los paquetes `cmake perl
pkg-config openssl-devel`/`libssl-dev`).

**El nodo no arranca: "Missing required configuration variables"** → falta
`HAZEL_SECRET_KEY`; ejecuta `python -m composer setup` o `python -m composer
env --init`.

**`el nodo no responde` en health** → revisa `python -m composer logs api` y
que el puerto 7272 no esté ocupado.

**Quieres volver a empezar** → `python -m composer reset` borra los contenedores
y sus volúmenes (destructivo).
