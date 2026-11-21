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
whose Kafka is down reports `kafka: error` in `/health/ready` and degrades to
local in-process delivery rather than losing chat entirely; this is a
degradation, not a second supported mode. `HAZEL_KAFKA_FANOUT_ENABLED=false`
exists only to run the test suite and local development without a broker.

---

## 5. Structure: the Rust crate under `rust/`

The application is Rust. `cargo build --release` produces one binary with two
roles (`node` and `group`, chosen by CLI argument).

**One struct, one file.** Every file defines at most one struct (or enum) and
its implementation. When a module needs another type it imports it instead of
declaring it locally. No source file is longer than ~220 lines.

| Directory | Responsibility | Knows HTTP? |
|---|---|---|
| `src/main.rs` | Entry point, role selection, setup, graceful shutdown | No |
| `src/config/` | `HAZEL_*` settings and simple `.env` parser | No |
| `src/models/` | One file per DTO / DB row, with its `FromRow`/`From` impl | No |
| `src/routes/<feature>/` | HTTP/WS bindings, grouped by responsibility | Yes |
| `src/events/` | In-process bus, subscriptions, Kafka fan-out, outbox | No |
| `src/calls/` | WebRTC rooms (`Peer`, `CallManager`) and signaling helpers | No |
| `src/supervisor/` | One child process per active group | No |
| `src/auth/`, `src/error/`, `src/utils/` | Extractors, problem+json, shared helpers | Partly |

**Why this separation:** business logic lives outside the route handlers so it
doesn't depend on axum. Domain errors are returned as `ApiError` and turned into
`problem+json` at the boundary, so handlers don't pick status codes ad hoc.

Each directory has a `mod.rs` that declares its children and re-exports them, so
external imports (`crate::models::*`, `crate::events::*`, …) did not change.
`src/routes/mod.rs` is the only place where a route group is added or removed.
`rust/Cargo.lock` pins every dependency.

Python survives only as `composer/`: environment generation, build, containers,
migrations and health checks. It is not part of the running application.

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
before the message is visible. The outbox is also the seam used by the Kafka
transport.

**Cross-process fan-out.** `events/kafka_bus.py` mirrors every committed event
onto the `hazel.events` topic and consumes it in every Hazel process with a
unique consumer group (fan-out, not competing consumers). The producer's own
instance id is carried in the payload so a process skips its own messages and
doesn't echo them back. Each process still uses the in-process bus for local
sockets; Kafka only connects the processes. Delivery stays at-least-once with no
replay for a socket that was offline, matching the v1 contract. If the broker
can't be reached at startup, the process logs the error and keeps local delivery
only; `/health/ready` reports `kafka: error`. The transport can be disabled with
`HAZEL_KAFKA_FANOUT_ENABLED=false` for local development.

## 9. Backups

Each node keeps its PostgreSQL as the source of truth. Backups must cover the
last 3 days of changes, so a restore can recover any recent state inside that
window. Backups stay with the node; off-site replication is not part of this
decision yet.

**Decision:** scheduled logical dumps, not WAL/PITR. `POST /backup` runs
`pg_dump --format=custom`, writes a `.dump` file plus a JSON manifest under
`HAZEL_STORAGE_ROOT/backups/{server_id}/`, and prunes files older than
`HAZEL_BACKUP_RETENTION_DAYS` (default 3). `POST /restore` checks the manifest's
`server_id` and runs `pg_restore --clean --if-exists`. WAL archiving would give
point-in-time recovery but needs continuous archiving and a much heavier setup
on an owner's PC; a nightly-style dump on demand covers the 3-day recovery
window with tools shipped in the runtime image (`postgresql-client`).

## Pending decisions

Resolved earlier in this document: server discovery (invite codes), backup
mechanism (logical dumps with a 3-day window), where files live (node disk) and
custom roles (not in v1).

Still open:

1. **Mobile** — native, Flutter, React Native? The API doesn't constrain it,
   but the client does.
