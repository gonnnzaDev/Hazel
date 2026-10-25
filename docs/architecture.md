# Hazel Architecture

Design-decision document. Each decision is written with its *why* so future
conversations have context and everything isn't reverted every time a new
idea shows up.

> The API contract lives in [`api.md`](./api.md). This document explains
> **why**; that one says **what**.

---

## 1. The product: what a "server" is

In Hazel a **server** is not an abstract concept in the cloud. It is a process
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

- Hazel's mental model is "my friend hosts this at home". A global registry
  implies a central authority, which is exactly what Hazel removes.
- It lets someone join a stranger's server frictionless: open the port,
  pick a nickname, join.
- It reduces attack surface: no passwords to leak, no brute force to implement.

**Decision:** the nickname is the identity and is scoped to one server. It is
the first thing requested when someone joins, so a person can be in several
servers and the nickname is requested again on each one. There is no global
account and no personal name for now; if private chats need one later, it will
be designed separately.

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

### Decision: Kafka is part of every install

**Owner's decision:** every PC runs a complete Kafka broker. There is no
embedded mode and no local fallback: Kafka is a base dependency, like
PostgreSQL, and the node is not expected to work without it.

This removes the mode switch: the installer and the compose stack bring Kafka
up with everything else, so the owner never has to configure it by hand. A node
whose Kafka is down reports the failure like any other dependency failure. The
chat bus can therefore assume Kafka exists when cross-process fan-out is
implemented.

---

## 5. Structure: feature modules under `src/`

Each feature lives in `src/<name>/` with the same layout always:

| Layer | File | Responsibility | Knows HTTP? |
|---|---|---|---|
| **Model** | `model.py` | Persistence (async SQLAlchemy) | No |
| **Repository** | `repository.py` | Queries and writes, no policy decisions | No |
| **Schema** | `schemas.py` | Pydantic contracts | No |
| **Service** | `service.py` | Business logic and orchestration | **No** |
| **View** | `view.py` | HTTP bindings | Yes |

**Why this separation:**

- The hard rule is that `service.py` (and `repository.py`) import nothing from FastAPI. Business
  logic can be tested without bringing the API up and will serve a future
  mobile client the same as a PC.
- Domain errors (`src/core/api/errors.py`) are raised from the service and
  translated to `application/problem+json` in a global handler. The service
  doesn't pick HTTP codes.

`src/core/registry.py` declares `INSTALLED_APPS`. It's the only place where a module
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

The lifecycle implemented by `servers`:

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

### Decisions

1. **The shareable address is detected automatically.** The node enumerates
   its interfaces and returns `recommended` plus every `candidates` entry,
   ordered private IPv4 first. The client uses `recommended` and only asks the
   owner to choose when there is no usable address. It never guesses a single
   address silently, because VPNs, Docker and several NICs make that wrong.
2. **Deletion stays hard for now.** `DELETE` removes the server row and its
   data. Soft delete is not implemented; if deleting heavy history becomes
   asynchronous, the `deleting` state comes back.

---

## 8. Realtime events

The general stream is `WS /api/v1/ws?token=<token>`. A token identifies one
server, so a socket is scoped to that server from the first frame. The server
sends a `connection.ready` event and then application events; channel-scoped
events require an explicit `channel.subscribe`.

**Why an in-process bus first.** `src/events/bus.py` is a small async pub/sub
with one bounded queue per socket. It adds no infrastructure, keeps working on
a single-process node, and makes the flow testable. Slow consumers are closed
instead of letting their queue grow without limit.

**Why events wait for commit.** Views call `events.outbox.queue_event()` and the
database dependency dispatches after `COMMIT`. This prevents the classic race
where a client receives `message.created` and immediately fetches history
before the message is visible. The outbox is also the seam for a future Kafka or
PostgreSQL transport.

**Known limitation.** The bus is process-local. The node and each group run in
separate processes, so a socket connected to one process does not see events
published by another process. The Kafka decision makes a broker available on
every node, so cross-process fan-out will move onto Kafka when implemented.
Until then, clients that use a single process for both HTTP and WebSocket are
fully covered.

## 9. Backups

Each node keeps its PostgreSQL as the source of truth. Backups must cover the
last 3 days of changes, so a restore can recover any recent state inside that
window. Backups stay with the node; off-site replication is not part of this
decision yet.

The mechanism (WAL archiving with point-in-time recovery, or scheduled dumps)
is an implementation detail still to be built. The fixed part is the 3-day
window.

## Pending decisions

These questions stay open on purpose, until you resolve them:

1. **Server discovery** — if a node listens on `192.168.1.50:7272`, how does a
   guest find it? Today the idea is sharing `host:port` by hand.
2. **Backup mechanism** — WAL archiving with point-in-time recovery, or
   scheduled dumps, to cover the 3-day window from section 9.
3. **Mobile** — native, Flutter, React Native? The API doesn't constrain it,
   but the client does.
