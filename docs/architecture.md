# Recop Architecture

Design-decision document. Each decision is written with its *why* so future
conversations have context and everything isn't reverted every time a new
idea shows up.

> The API contract lives in [`api.md`](./api.md). This document explains
> **why**; that one says **what**.

---

## 1. The product: what a "server" is

In Recop a **server** is not an abstract concept in the cloud. It is a process
running on someone's PC and listening on a port of that machine.

```
Owner                                Guest
  │                                     │
  │  starts the node                    │
  │  → opens :7272 on their PC          │
  │                                     │
  └────────── shares host:port ──────────► connects
                                                │
                                          joins with nickname
```

**Direct consequences:**

- If the owner turns their PC off, the server stops existing for the outside world.
  That is correct: nobody can command a server that isn't running.
- If the process dies from a crash, the server becomes **inactive**, not
  destroyed. All its data survives in PostgreSQL. When bringing it back up,
  everything is still there.
- Deleting a server is the owner's decision. If deleted, the port closes
  and there is nobody left to point to.

---

## 2. Identity: nickname and nothing else

**Decision:** no global accounts. No email, no password, no registration.

A person identifies themselves with a **nickname inside a server**. The same
nickname on two servers are two unrelated people.

**Why:**

- Recop's mental model is "my friend hosts this at home". A global registry
  implies a central authority, which is exactly what Recop removes.
- It lets someone join a stranger's server frictionless: open the port,
  pick a nickname, join.
- It reduces attack surface: no passwords to leak, no brute force to implement.

**Pending owner's decision:** the user reserves a personal name for personal
use (private chats). Explicitly out of scope until designed; the architecture
doesn't prevent it.

### Roles

The server owner is its administrator. Roles are modeled by level:

| Level | Role | Can |
|---|---|---|
| `owner` | Owner | Everything, including deleting the server |
| `admin` | Administrator | Manage channels and members |
| `member` | Member | Chat |

---

## 3. Why PostgreSQL

The server stores messages, channels, members and the server's own state.
We need:

- Durability: if the process crashes, nothing is lost.
- History queries with pagination and filters.
- Real referential integrity between channels, messages and members.
- Concurrency controls: several people can write to the same channel at
  the same time.

SQLite doesn't reasonably provide any of this when chat is real.

---

## 4. Why Kafka for chat

**Owner's decision:** Apache Kafka transports chat.

Kafka provides:

- **Fan-out** to several consumers of the same topic, which is literally what
  a channel with N connected people does.
- **Replay**: a reconnecting client can read again from an offset.
- **Decoupling**: the producer (writer) doesn't need to know the consumers
  (listeners).
- **Failure isolation**: if a consumer crashes, the message stays in the log.

### The tension to keep in mind

> **Kafka is a heavy dependency for a process running on a user's PC.**
> Talking to a single broker means bringing up ZooKeeper or KRaft, keeping
> ZooKeeper operational, and keeping it running.

This is a real contradiction with the self-hosting goal and must be resolved
before the product is used. Options, **pending your decision**:

1. **Embedded mode**: Kafka runs inside the same Recop node, in a separate
   process the node launches and manages. The owner never sees it; if something
   fails, the node reports it.
2. **Transport with abstraction**: the chat bus is an interface with a Kafka
   implementation and a local implementation. Kafka is the "real" mode
   (multi-user, several nodes), local mode is the default for a single owner.
3. **Pure Kafka**: the owner must run Kafka before Recop. Simple to implement,
   high startup friction.

The chat PR implementation will expose the bus as an **interface**, so the
decision isn't blocked. But it should be resolved before building on Kafka.

---

## 5. Structure: Django-style apps

Each feature lives in `apps/<name>/` with the same layout always:

| Layer | File | Responsibility | Knows HTTP? |
|---|---|---|---|
| **Model** | `models.py` | Persistence (async SQLAlchemy) | No |
| **Schema** | `schemas.py` | Pydantic contracts | No |
| **Service** | `services.py` | Business logic | **No** |
| **View** | `api/` | HTTP bindings | Yes |

**Why this separation:**

- The hard rule is that `services.py` imports nothing from FastAPI. Business
  logic can be tested without bringing the API up and will serve a future
  mobile client the same as a PC.
- Domain errors (`core/api/errors.py`) are raised from the service and
  translated to `application/problem+json` in a global handler. The service
  doesn't pick HTTP codes.

`core/registry.py` declares `INSTALLED_APPS`. It's the only place where an app
is added or removed, and defines the order in which Alembic sees models.

---

## 6. Mobile later, without rewriting anything

The API is HTTP + WebSocket, served by Uvicorn, and the contract is
self-documented in OpenAPI. That means the backend doesn't assume the client
is a PC.

What should hold from now:

- **Explicit contract**: Pydantic schemas are the contract. If it changes, the
  mobile client learns about it when generating its types.
- **No server-side session state** beyond a connection's natural lifetime.
  No `HttpOnlySession` tied to a browser.
- **Uniform errors** (`application/problem+json`): a mobile client can display
  the error without special cases.
- **Versioned under `/api/v1`** from day one. Changing the contract later would
  be a problem; changing it with a version prefix is not.

---

## 7. Server state

The lifecycle implemented by `apps/servers`:

| State | Meaning | Accepts connections? |
|---|---|---|
| `creating` | Being set up. Ephemeral, never exposed to client | No |
| `active` | Running | **Yes** |
| `inactive` | Turned off or crashed process | No |
| `deleted` | Deleted by owner | No |

Two rules sustaining the product:

**Create implies activate.** The owner asked to deploy, and a deployed server
listens. No intermediate state remains that the client can observe.

**On node start, everything marked `active` becomes `inactive`.**
This makes the requirement work that "if the process closes, the server stays
inactive but doesn't work". Without this, a crashed server would stay marked
`active` in the DB and the system would believe its port is open. When turning
it back on, the owner reactivates it and finds it **the same**: same channels,
same members, same messages.

> There is no `deleting` state. It was evaluated and discarded: deletion is
> synchronous and immediate, so an intermediate state would never be observable
> by anyone. If deletion ever becomes async because heavy history must be
> cleaned, it comes back.

### Endpoints

```
POST   /api/v1/servers                     deploy (creates and activates)
GET    /api/v1/servers                     list, paginated
GET    /api/v1/servers/{id}                detail with channels
GET    /api/v1/servers/by-slug/{slug}      lookup by shared identifier
PATCH  /api/v1/servers/{id}                edit name / port / member limit
POST   /api/v1/servers/{id}/activate       reopen the port
POST   /api/v1/servers/{id}/deactivate     close the port (keeps data)
POST   /api/v1/servers/{id}/heartbeat      report process is still alive
GET    /api/v1/servers/{id}/address        the host:port to share
DELETE /api/v1/servers/{id}                delete permanently
```

### Two unresolved things

1. **The shareable address isn't always shareable.** By default the node listens
   on `0.0.0.0`, which is a wildcard: you can't connect to `0.0.0.0`. The API
   flags it with `host_is_wildcard: true` instead of guessing the owner's IP,
   because a node can have VPN, docker or several NICs. Still to decide how it
   resolves: does the owner type their IP by hand, do we detect it, or ask once
   at deploy time?
2. **Deletion is hard.** Today `DELETE` removes the row. With messages inside
   that's irreversible. Do you want soft delete, or keep and mark the server as
   deleted?

---

## Pending decisions

These questions stay open on purpose, until you resolve them:

1. **Kafka on the user's PC** — how to solve the heavy-dependency problem?
   (see section 4)
2. **Server discovery** — if a node listens on `192.168.1.50:7272`, how does a
   guest find it? Today the idea is sharing `host:port` by hand.
3. **Personal name vs nickname** — the user mentioned a personal name for
   personal use. Is it the same entity or separate?
4. **Per-owner persistence** — does each node keep everything in its local
   PostgreSQL, or is there backup/replication?
5. **Mobile** — native, Flutter, React Native? The API doesn't constrain it,
   but the client does.
