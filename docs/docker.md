# Docker

The idea is that anyone cloning the repo gets **exactly the same environment**,
without installing Python, PostgreSQL or Kafka by hand.

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
cp .env.example .env
# generate a real secret
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
#   ↑ copy it to RECOP_SECRET_KEY in .env

docker compose up
```

That brings up the node, PostgreSQL and Kafka. The API lands at
<http://localhost:7272/docs>.

---

## The two composes

| File | What it brings up | When |
|---|---|---|
| `docker-compose.yml` | Node + PostgreSQL + Kafka | To run everything containerized, same as production |
| `docker-compose.dev.yml` | Only PostgreSQL + Kafka | For development: the API runs on your machine and reloads on save |

For development:

```bash
docker compose -f docker-compose.dev.yml up -d
make migrate
make api          # runs on your machine, with reload
```

---

## Multi-architecture image

The base image is pinned **by digest**, and it's the multi-architecture index
digest, not a single platform's. That's why the same build produces the right
image on each machine:

| Platform | Used by |
|---|---|
| `linux/amd64` | Intel/AMD PC, Windows with Docker Desktop, Intel Mac |
| `linux/arm64/v8` | Apple Silicon, 64-bit Android (Termux) |
| `linux/arm/v7` | 32-bit Android, Raspberry Pi |
| `linux/386` | 32-bit x86 |
| `linux/ppc64le` | Old Raspberry Pi, some SBCs |

To build them all at once:

```bash
docker buildx create --use --name recap   # only once
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t gonnnzadev/recop:0.1.0 \
  --push .
```

> Android doesn't run native Docker. The way in is **Termux**, which does run
> containers on Android 7 and up. Install scripts account for it.

---

## What the image does

**Multi-stage.** The first stage compiles dependencies with `uv`; the second
copies only the result. The final image carries neither the compiler, nor `uv`,
nor source code no longer used.

**Unprivileged user.** Runs as `recap` (uid 1001). A node is a process living
on someone's PC; it shouldn't be able to write to `/usr` or create users.

**`tini` as PID 1.** Without it, `SIGTERM` never reaches Uvicorn and every
`docker compose restart` takes 10 seconds. With `tini`, the signal arrives,
Uvicorn closes WebSocket connections and the container exits cleanly.

**Migrations.** The entrypoint waits for PostgreSQL to answer and then runs
`alembic upgrade head`. It's required: in Docker the API and DB start at the
same time, and PostgreSQL takes a few seconds to accept connections.

```
==> waiting for the database (timeout: 60s)
    database ready (postgres:5432/recop)
==> applying migrations
==> starting the node
```

If you run several replicas of the same node, set `RECOP_AUTO_MIGRATE=false` on
all but one, or they'll step on each other.

---

## Configuration

Done via environment variables, not files. Compose reads `.env`.

| Variable | What for | Default |
|---|---|---|
| `RECOP_SECRET_KEY` | Signs tokens. **Required in production.** | — |
| `RECOP_PUBLISH_HOST` | Interface where the port is published | `0.0.0.0` |
| `RECOP_PUBLISH_PORT` | Published port on your machine | `7272` |
| `RECOP_AUTO_MIGRATE` | Apply migrations on start | `true` |
| `RECOP_ENV` | `local` \| `test` \| `prod` | `prod` in the image |
| `RECOP_DATABASE_URL` | PostgreSQL connection | points to `postgres:5432` |

If `RECOP_SECRET_KEY` is missing, compose fails with:

```
RECOP_SECRET_KEY: set RECOP_SECRET_KEY in your .env
```

It's intentional: better not to start than to start with the example secret
from `.env.example`.

---

## Useful commands

```bash
docker compose up -d              # bring up in background
docker compose logs -f api        # follow node logs
docker compose ps                 # status and health
docker compose exec api python -m core.cli --help
docker compose down               # stop, keep data
docker compose down -v            # stop and DELETE volumes
docker compose exec postgres psql -U recap -d recop   # enter the DB
```

Data lives in `postgres_data` and `kafka_data` volumes. `down` keeps them;
`down -v` deletes them.

---

## Frequent issues

**Port already in use**

```bash
RECOP_PUBLISH_PORT=8080 docker compose up
```

**`permission denied` mounting volumes**

Shouldn't happen on Linux; on Docker Desktop, check the project is on a path
Docker can access.

**Node restarts in a loop**

Almost always it can't connect to the DB. Look at:

```bash
docker compose logs api
```

If it says `database didn't respond`, the problem is in `postgres`, not Recop.

**Nobody can join me from the local network**

`RECOP_PUBLISH_HOST` must be `0.0.0.0`, not `127.0.0.1`. And the system firewall
must let the port through.
