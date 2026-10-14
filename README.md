<h1 align="center">Hazel</h1>

<p align="center">
  <b>Your chat. Your machine. Your port.</b><br>
  Chat with your friends on a server living on your own computer.
</p>

---

## What it is

Hazel is a Discord-like chat, but **with no one in the middle**. No company, no third-party servers: you turn the server on yourself.

1. Turn your server on.
2. Share your address with your friends.
3. Chat.
4. When you want, turn it off and everything shuts down.

**No accounts:** you join with a name and that's it. The same name can exist on two different servers, and they are two different people.

**No surprises:** if the service goes down, it's because you turned your computer off.

---

## What you need

- Docker, or Python 3.14+, PostgreSQL and Kafka if you prefer a manual install
- Git
- Your friends must be able to reach your computer (the port you choose has to be accessible)

---

## Installation

### With Docker (easiest)

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
./scripts/setup.sh
docker compose up
```

### Manual

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
uv sync
echo "HAZEL_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" > .env
docker compose up -d
uv run alembic upgrade head
uv run python -m core
```

> Coming soon: a one-step installer for Windows, macOS, Linux and Android (Termux).

---

## How to use

Turn everything on:

```bash
make up     # database and Kafka
make api    # your node
```

In another terminal, create your server:

```bash
curl -X POST localhost:7272/api/v1/servers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Luis House","slug":"luis-house",
       "owner_nickname":"luis","bind_port":7272}'
```

It returns an `id` and your port stays open.

Then, everyday usage:

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

---

## What happens when you turn it off

| State | Port | Your data |
|---|---|---|
| Active | Open | Intact |
| Turned off on purpose | Closed | Intact |
| Turned off by crash | Closed | Intact |
| Deleted | Closed | Deleted |

**Turning off never deletes anything.** If your computer restarts, your servers come back turned off but with everything inside. Turn them back on and they continue as you left them.
