<h1 align="center">Hazel</h1>

<p align="center">
  <b>Your chat. Your machine. Your port.</b><br>
  Chat with your friends on a server living on your own computer.
</p>

---

## What it is

Hazel is a Discord-like chat, but **with no one in the middle**. No company, no
third-party servers: you turn the server on yourself.

1. Turn your server on.
2. Share your address with your friends.
3. Chat.
4. When you want, turn it off and everything shuts down.

**No accounts:** you join with a name and that's it. The same name can exist on
two different servers, and they are two different people.

**No surprises:** if the service goes down, it's because you turned your
computer off.

---

## Architecture

| Piece | Language | Role |
|---|---|---|
| Node (`rust/`) | **Rust** (axum, tokio, sqlx, rdkafka) | The application: HTTP API, WebSockets, group supervisor. |
| Composer (`composer/`) | **Python 3 stdlib** | The *only* orchestrator: environment, build, containers, migrations, health. |

There is no `docker compose`, no `Makefile` and no shell/PowerShell scripts.
`python -m composer` does all of that, using the Docker CLI directly. Python is
not needed to run the node — only to compose it.

---

## What you need

- Python 3 (only for `composer`), Rust (to build from source) and Docker
- Git
- Your friends must be able to reach your computer (the port you choose has to be accessible)

---

## Installation

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
python -m composer setup
```

`setup` is idempotent: it checks the tools, generates `.env` with a fresh secret
and admin token, compiles the Rust binary, starts PostgreSQL and Kafka, applies
the SQL migrations and leaves everything ready.

If Docker is not available, it still generates `.env` and builds the binary;
point `HAZEL_DATABASE_URL` and `HAZEL_KAFKA_BOOTSTRAP_SERVERS` to your own
services and run `python -m composer migrate` when your database is reachable.

---

## Everyday use

```bash
python -m composer up              # PostgreSQL + Kafka (development)
python -m composer api             # run the Rust node on this machine
python -m composer up full         # everything in containers, node included

python -m composer down            # stop, keep the data
python -m composer reset           # stop and delete the volumes
python -m composer logs kafka -f   # follow a service's logs
python -m composer ps              # what is running
python -m composer health          # /health and /health/ready
python -m composer check           # fmt + clippy + tests + composer syntax
python -m composer help            # all commands
```

`composer api` owns the whole foreground session: when the node stops (Ctrl+C,
SIGTERM or a crash), it shuts down its group processes and stops every Hazel
container (PostgreSQL and Kafka), so nothing is left running in the background.
Use `python -m composer api --keep-services` if you want to keep them up.
This does not delete any data. A `kill -9` of the composer process (or a power
loss) cannot run this cleanup.

In another terminal, create your server:

```bash
curl -X POST localhost:7272/api/v1/servers \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(grep HAZEL_ADMIN_TOKEN .env | cut -d= -f2)" \
  -d '{"name":"Luis House","slug":"luis-house",
       "owner_nickname":"luis","bind_port":7272}'
```

It returns an `id`. Then, everyday usage:

```bash
# See the address to share with your friends
curl localhost:7272/api/v1/servers/{id}/address

# See your servers
curl localhost:7272/api/v1/servers

# Turn a server off (nothing is lost)
curl -X POST localhost:7272/api/v1/servers/{id}/deactivate

# Turn it back on
curl -X POST localhost:7272/api/v1/servers/{id}/activate
```

The API contract lives in [`docs/api.md`](./docs/api.md).

---

## What happens when you turn it off

| State | Port | Your data |
|---|---|---|
| Active | Open | Intact |
| Turned off on purpose | Closed | Intact |
| Turned off by crash | Closed | Intact |
| Deleted | Closed | Deleted |

**Turning off never deletes anything.** If your computer restarts, your servers
come back turned off but with everything inside. Turn them back on and they
continue as you left them.

Stopping `composer api` also stops the background stack: PostgreSQL, Kafka and
any group process spawned by the node. Containers keep their volumes; the next
`python -m composer up` (or `setup`) brings them back with the data intact.
