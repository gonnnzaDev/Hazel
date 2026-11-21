# Docker

Python es el **único composer**: no hay `docker compose`, ni `Makefile`, ni
scripts. Todo se hace con `python -m composer`, que usa el CLI de Docker.

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
python -m composer setup
```

`setup` genera `.env`, compila el nodo Rust, crea la red `hazel`, arranca
PostgreSQL y Kafka y aplica las migraciones SQL.

## Perfiles

| Comando | Qué arranca |
|---|---|
| `python -m composer up` | PostgreSQL + Kafka (para desarrollar el nodo en local) |
| `python -m composer up full` | Nodo + PostgreSQL + Kafka, todo en contenedores |
| `python -m composer api` | El binario Rust en esta máquina |

Los contenedores se llaman `hazel-postgres`, `hazel-kafka` y `hazel-api`
(`-dev` si usas el perfil por defecto). Los volúmenes se conservan al hacer
`down` y se borran con `reset`.

## Comandos útiles

```bash
python -m composer ps                 # estado y health
python -m composer logs kafka -f      # seguir logs
python -m composer health             # /health y /health/ready
python -m composer restart full
python -m composer down               # parar, sin borrar datos
python -m composer reset              # parar y BORRAR volúmenes
```

Acceso directo a la base, si hace falta:

```bash
docker exec -it hazel-postgres-dev psql -U hazel -d hazel
```

## Puertos

El nodo publica `7272` (HTTP/WS) y el rango `7273-7400` para los procesos
grupo. Se pueden cambiar con `HAZEL_PUBLISH_PORT`, `HAZEL_PUBLISH_HOST` y
`HAZEL_GROUP_PORT_END` en `.env`.

## La imagen

`Dockerfile` es multi-etapa: compila con `rust:1.100-bookworm` y ejecuta sobre
`debian:bookworm-slim`, sin toolchain ni Python. El binario es PID 1 y recibe
SIGTERM directamente (no hay `tini` ni entrypoint). El healthcheck consulta
`/health`.

Las migraciones no las hace la imagen: las aplica el composer antes de
arrancar el nodo, con `psql` dentro del contenedor de PostgreSQL.
