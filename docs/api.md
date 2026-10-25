# Hazel API

Full system contract. This document is the reference: what is here is what the
API must expose, before the implementation exists.

**Endpoint status:**

| Mark | Meaning |
|---|---|
| `[x]` | Implemented and tested |
| `[~]` | Partial |
| `[ ]` | Planned, doesn't exist yet |

---

## How to read this document

- Endpoints hang off `/api/v1`.
- Everything but `GET` accepts and returns JSON.
- Errors use `application/problem+json` (RFC 9457).
- There are no global accounts. **Identity is a nickname inside a server**,
  requested first when joining.
- WebSocket at `/api/v1/ws`.

---

## 0. Concepts

Before endpoints, the four things to be clear about.

### Node

The Hazel process running on a PC. It is **the unit someone installs and
brings up**. A node:

- listens on **a single port**
- can host **several servers**
- is owned by whoever brought it up

The node port is what gets shared. When the node shuts down, the port closes
and **nobody else can enter any of its servers**. When it comes back, data is
still there.

### Server

A "server" in the Discord sense: a group of people with their own channels.
Belongs to a node. Creating and deleting a server **doesn't** open or close the
node port: that's what the node lifecycle is for.

> **Design decision for you to review.** Your original description was "I deploy
> my server and a port opens on my PC". The reading I implemented is: the
> **node** owns the port, and servers live inside. That's what lets a client
> (PC or future mobile) connect to a single address and see several servers,
> like in Discord. The alternative is 1 node = 1 server = 1 process per group,
> more literal but forcing a process per chat you own. Tell me which you prefer.

### Member

A person inside a server, identified by their **nickname**. The same nickname
on two different servers are two unrelated people.

### Channel

A room inside a server. There are text and voice channels.

---

## 1. Node — process lifecycle

```
                  ┌──────────────────────────────────────────┐
                  │              NODE                        │
   port           │                                          │
   closed ───────┤  server_a    server_b    server_c        │
                  │  │             │             │          │
   port  ────────┤  └─ channels ───┴─ channels ───┘          │
   open          │                                          │
                  └──────────────────────────────────────────┘
```

| Method | Route | What it does |
|---|---|---|
| `[x]` | `GET /health` | Liveness. Answers if the process is alive. |
| `[x]` | `GET /health/ready` | Readiness. Checks DB and Kafka. 503 if it can't serve. |
| `[x]` | `GET /api/v1/node` | Node card: version, port, capabilities. |
| `[x]` | `GET /api/v1/node/address` | Real address to share. Resolves the local IP. |

> **There is no `POST /node/start` nor `POST /node/stop`.** The node port is the
> process port: if the node is running, the port is open. An HTTP endpoint that
> shuts down its own HTTP process is hard to reason about and test, and adds
> nothing `Ctrl+C` or `docker compose stop` don't do better. The owner stops
> their node from outside and data stays intact.

### `GET /api/v1/node/address` — the critical point

This endpoint solves `0.0.0.0` not being connectable.

```json
{
  "port": 7272,
  "bind_host": "0.0.0.0",
  "is_wildcard": true,
  "recommended": "192.168.1.50",
  "candidates": [
    { "host": "192.168.1.50", "family": "ipv4", "private": true, "loopback": false },
    { "host": "10.8.0.2",     "family": "ipv4", "private": true, "loopback": false }
  ]
}
```

The backend **doesn't guess a single answer**: it returns every address found,
sorted (private IPv4, private IPv6, public, loopback), and `recommended` is just
the first one. A node can have VPN, docker, or three NICs, and picking wrong is
worse than showing options.

If the machine has no usable address — a container without network, for
example — it returns `candidates: []` and `recommended: null` instead of
failing. The client shows a useful message.

**Decision:** the address is detected automatically. The client uses
`recommended` and lets the owner override it from `candidates` when the machine
has VPN, Docker or several NICs. If no usable address exists, the client asks
the owner to type one.

---

## 2. Servers (guilds)

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/servers` | Create a server. |
| `[x]` | `GET /api/v1/servers` | List, paginated. |
| `[x]` | `GET /api/v1/servers/{server_id}` | Detail with channels. |
| `[x]` | `GET /api/v1/servers/by-slug/{slug}` | Lookup by identifier. |
| `[x]` | `PATCH /api/v1/servers/{server_id}` | Edit name, description, limits. |
| `[x]` | `DELETE /api/v1/servers/{server_id}` | Delete permanently. |
| `[x]` | `POST /api/v1/servers/{server_id}/activate` | Active server. |
| `[x]` | `POST /api/v1/servers/{server_id}/deactivate` | Inactive server, keeps data. |
| `[x]` | `POST /api/v1/servers/{server_id}/heartbeat` | Process heartbeat. |
| `[x]` | `GET /api/v1/servers/{server_id}/address` | Address: node port + its slug. |

### States

| State | Accepts traffic |
|---|---|
| `creating` | No (ephemeral, never visible to client) |
| `active` | **Yes** |
| `inactive` | No — turned off or crashed process |
| `deleted` | No — terminal |

> `inactive` is **not** "deleted". An inactive server keeps channels, members
> and messages, and can be activated again. On node start, every server marked
> `active` becomes `inactive`, because if the previous process closed that port
> is no longer listening.

---

## 3. Identity — nicknames

Here is the product heart: **no global accounts**. Someone opens a node port,
picks a nickname and joins. No email, no password, no registration.

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/servers/{server_id}/join` | Join with a nickname. Returns token. |
| `[x]` | `POST /api/v1/servers/{server_id}/leave` | Leave the server. |
| `[x]` | `POST /api/v1/auth/refresh` | Renew token (rotates the old one). |
| `[x]` | `POST /api/v1/auth/logout` | Revoke this device token. |
| `[x]` | `POST /api/v1/auth/logout-all` | Revoke all tokens on this server. |
| `[x]` | `GET /api/v1/me` | Who I am on this token's server. |
| `[x]` | `PATCH /api/v1/me` | Change my display name. |
| `[x]` | `GET /api/v1/servers/{server_id}/members` | List members. |
| `[x]` | `GET /api/v1/servers/{server_id}/members/{nickname}` | See a member. |
| `[x]` | `DELETE /api/v1/servers/{server_id}/members/{nickname}` | Kick. |
| `[x]` | `PUT /api/v1/servers/{server_id}/members/{nickname}/role` | Change role (`?role=admin`). |

### `POST /api/v1/servers/{server_id}/join`

```http
POST /api/v1/servers/01a1.../join
{ "nickname": "Ana" }
```

```json
{
  "token": "kJ8xQm2nVr7pL4sT...",
  "expires_at": "2026-11-10T03:14:00Z",
  "member": {
    "id": "01a1...",
    "nickname": "ana",
    "display_name": "Ana",
    "role": "owner",
    "is_online": false,
    "last_seen_at": null,
    "joined_at": "2026-10-11T23:50:17Z"
  },
  "server": { "id": "01a1...", "slug": "luis-house", "name": "Luis House" }
}
```

The role comes out as **text** (`"owner"`), not the number stored in the DB.
The DB sorts by number because comparing roles is comparing integers; the API
speaks words because a client shouldn't need to know admin is 50.

**The token is scoped to the server.** The same token doesn't work on another
server. If Ana is on `luis-house` and `tuesday-gym`, she has **two different
tokens**: two different identities, not one person with two profiles.

### Nickname rules

Centralized in `src/common/nickname.py`:

- 2 to 32 characters
- Only `a-z`, `0-9`, `.`, `_`, `-`
- Normalized: `"  José  Luis "` → `"jose_luis"`
- Reserved: `admin`, `everyone`, `here`, `sistema`, `hazel`, `root`, ...

A nickname can be valid on one server and taken on another. That's not a
conflict: it's the point.

### Rejoining

If the nickname already exists on that server, **joining again with the same
name works**: you recover access and get a new token. That's how "I lost my
password" is solved in a product without accounts: join again with the same
name.

The trade-off is explicit: someone guessing your nickname joins as you. On a
local network with friends it's acceptable; on an open server it wouldn't be,
which is why rate limits and member caps exist.

### The owner

- The **first member** of a server is its owner.
- If the owner leaves, the role passes to the **oldest** remaining member. A
  server without owner couldn't be managed or deleted.
- Not even an admin can kick the owner. The owner leaves if they want.
- The owner role isn't assigned or removed via API.

---

## 4. Roles and permissions

| Method | Route | What it does |
|---|---|---|
| `[ ]` | `GET /api/v1/servers/{server_id}/roles` | List roles. |
| `[ ]` | `POST /api/v1/servers/{server_id}/roles` | Create custom role. |

The three base roles already apply: a member stops being `member` and becomes
`admin` with `PUT .../role?role=admin`.

### Base roles

| Role | Can |
|---|---|
| `owner` | Everything, including deleting server and node. Can't be removed or handed off. |
| `admin` | Manage channels, members and roles. Can't delete server. |
| `member` | Chat. Default role for anyone joining. |

Custom roles come later. The permission model stays open for you to define.

---

## 5. Channels

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/servers/{server_id}/channels` | Create channel. |
| `[x]` | `GET /api/v1/servers/{server_id}/channels` | List channels. |
| `[x]` | `GET /api/v1/servers/{server_id}/channels/{channel_id}` | See a channel. |
| `[x]` | `PATCH /api/v1/servers/{server_id}/channels/{channel_id}` | Edit. |
| `[x]` | `DELETE /api/v1/servers/{server_id}/channels/{channel_id}` | Delete. |
| `[~]` | `POST /api/v1/servers/{server_id}/channels/{channel_id}/join` | Join channel (open socket). |

Each server has exactly one `is_default` channel, where people land on join.
Guaranteed by DB constraint, not just code.

> The `join` endpoint validates that the member can reach the channel of an
> active server and returns the channel; attaching a live socket to the event
> stream lands with the realtime feature.

---

## 6. Messages

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/channels/{channel_id}/messages` | Publish. |
| `[x]` | `GET /api/v1/channels/{channel_id}/messages` | Paginated history. |
| `[x]` | `GET /api/v1/channels/{channel_id}/messages/{message_id}` | See one. |
| `[x]` | `PATCH /api/v1/channels/{channel_id}/messages/{message_id}` | Edit. |
| `[x]` | `DELETE /api/v1/channels/{channel_id}/messages/{message_id}` | Delete. |
| `[x]` | `POST /api/v1/channels/{channel_id}/messages/{message_id}/reactions` | React. |
| `[x]` | `DELETE /api/v1/channels/{channel_id}/messages/{message_id}/reactions/{emoji}` | Remove reaction. |

### History pagination

Cursor navigation: `GET /api/v1/channels/01a1.../messages?limit=50&before=01a1...f3e2`.
Cursors use `message_id`, which is UUID v7, so id order **is** chronological
order; no extra index or `created_at` column is needed for sorting. The
response carries `{ items, limit, next_cursor }` and `next_cursor` is what you
pass back as `before`.

### Publishing a message

```http
POST /api/v1/channels/01a1.../messages
Authorization: Bearer <token>

{ "content": "anyone up?", "reply_to": "01a1...", "attachments": [] }
```

```json
{
  "id": "01a12d5f-d54a-7b90-57047f430a41",
  "channel_id": "01a12d5f-d54a-715f-a24a-2e3e9f0f0bf6",
  "author": { "nickname": "ana", "display_name": "Ana" },
  "content": "anyone up?",
  "created_at": "2026-10-11T23:52:03Z",
  "edited_at": null,
  "reactions": [],
  "reply_to": "01a1...",
  "attachments": []
}
```

**Limits:** 4000 bytes per message, 20 messages per minute per nickname. Rate
limit is per nickname, not per IP: on a local network everyone can sit behind
the same router and cutting service wouldn't be fair. Both limits live in
`config/limits_config.py`.

**History pagination** returns `{ items, limit, next_cursor }`. `next_cursor`
is the id of the oldest item; pass it as `before` on the next page. `null`
means the history ends there.

**Deletion is logical.** A deleted message keeps its id and author but
exposes `content: null` and `deleted: true`. Replying to or reacting on a
deleted message returns `409 message_deleted`.

**Ownership rules** (decided): only the author edits a message; the author or
an admin deletes it. Deleting is soft (`deleted_at`); history stays readable.

**Reactions** are free-form (any emoji up to 64 chars), one per member per
emoji. `POST` is idempotent: reacting twice returns the message unchanged.
`DELETE /reactions/{emoji}` removes *your* reaction; removing one you never
added returns `204` as well.

**Attachments** are reserved: the field exists and must be empty
(`attachments: []`) until the files feature fills it.

---

## 7. WebSocket — realtime

| Method | Route | What it does |
|---|---|---|
| `[x]` | `WS /api/v1/ws?token=<token>` | General event channel. |

Token goes in query string because browsers and several mobile clients don't
allow custom headers on the WebSocket handshake. The socket is authenticated
once at connect time. The token must belong to an **active** server; invalid,
expired, foreign-server and inactive-server tokens close with code `1008`.

Every event uses the same envelope. `channel_id` is present only for
channel-scoped events:

```json
{ "type": "message.created", "server_id": "...", "channel_id": "...", "data": { } }
```

Server-scoped events go to every socket connected to that server.
Channel-scoped events go only to sockets that have subscribed to the channel.

### Server events

| Event | When |
|---|---|
| `connection.ready` | The socket is authenticated. Data: `member`, `server`. |
| `message.created` | Someone wrote in a subscribed channel. |
| `presence.update` | A member's first socket connected or last socket disconnected. |
| `typing.start` | A subscribed member is typing. |
| `member.joined` | Someone joined the server. |
| `member.left` | Someone left or was kicked. |
| `server.updated` | Name, description or limits changed. |
| `server.state_changed` | Server was created, activated, deactivated or deleted. |
| `channel.subscribed` | The server accepted a `channel.subscribe` request. |
| `channel.unsubscribed` | The channel subscription was removed. |
| `heartbeat` | Acknowledgement of a client heartbeat. Data: `server_time`. |
| `error` | A client event was invalid. Data: `code`, `detail`. |

Planned, not emitted yet because their HTTP endpoints are not implemented:
`message.updated`, `message.deleted`, `reaction.added`, `reaction.removed`,
`node.state_changed`.

### Client events

```json
{ "type": "channel.subscribe", "channel_id": "..." }
{ "type": "channel.unsubscribe", "channel_id": "..." }
{ "type": "typing.start", "channel_id": "..." }
{ "type": "heartbeat" }
```

A client must send `channel.subscribe` before it receives channel-scoped
events. `typing.start` is only accepted for subscribed channels and is
broadcast to the other subscribers. The server ignores unknown event types
instead of dropping the connection, so an old mobile client that doesn't know
a new event doesn't crash.

---

## 8. Invites and discovery

| Method | Route | What it does |
|---|---|---|
| `[ ]` | `POST /api/v1/servers/{server_id}/invites` | Create invite. |
| `[ ]` | `GET /api/v1/invites/{code}` | See an invite. |
| `[ ]` | `DELETE /api/v1/invites/{code}` | Revoke. |

**Decision made:** discovery is manual. No central registry publishing "there's
a server at 192.168.1.50:7272". The owner shares `host:port` as shared before
the internet: by message. An invite is a short code pointing to the node, so you
don't type the IP by hand.

> **Pending your decision:** is sharing `host:port` enough, or do you want some
> discovery form (short-code invite, QR, public server directory)?

---

## 9. Files

| Method | Route | What it does |
|---|---|---|
| `[ ]` | `POST /api/v1/channels/{channel_id}/attachments` | Upload. |
| `[ ]` | `GET /api/v1/attachments/{attachment_id}` | Download. |
| `[ ]` | `DELETE /api/v1/attachments/{attachment_id}` | Delete. |

> **Pending your decision:** do files live on node disk, or external storage (S3
> and compatibles)? On a self-hosted node, local disk is simple, but capped by
> the owner's PC space.

---

## 10. Maintenance

| Method | Route | What it does |
|---|---|---|
| `[ ]` | `GET /api/v1/servers/{server_id}/stats` | Members, messages, size. |
| `[ ]` | `POST /api/v1/servers/{server_id}/backup` | Backup to file. |
| `[ ]` | `POST /api/v1/servers/{server_id}/restore` | Restore from backup. |
| `[ ]` | `GET /api/v1/servers/{server_id}/events` | Audit. |

This isn't secondary: it's what gives the owner confidence their data is on
their PC and recoverable. Backups must cover the last 3 days of changes; the
storage mechanism and the endpoint contract are still to be implemented (see
`architecture.md` §9).

---

## 11. Errors

All errors use `application/problem+json`:

```json
{
  "type": "https://hazel.dev/errors/server_inactive",
  "title": "Server inactive",
  "status": 409,
  "code": "server_inactive",
  "detail": "Server is inactive. It accepts no connections until its owner activates it again.",
  "server_id": "01a1...",
  "status": "inactive"
}
```

### Catalog

| `code` | HTTP | When |
|---|---|---|
| `server_not_found` | 404 | Server doesn't exist. |
| `server_not_found_by_slug` | 404 | No server with that identifier. |
| `server_inactive` | 409 | Tried to use a turned-off server. |
| `server_deleted` | 409 | Tried to use a deleted server. |
| `invalid_state_transition` | 409 | Impossible lifecycle transition. |
| `slug_taken` | 409 | Identifier already exists. |
| `port_taken` | 409 | Port taken by another active server. |
| `nickname_taken` | 409 | Nickname already exists on that server. |
| `nickname_reserved` | 422 | Nickname is on the reserved list. |
| `nickname_invalid_charset` | 422 | Disallowed characters. |
| `nickname_too_short` / `_too_long` | 422 | Length out of range. |
| `unauthenticated` | 401 | Missing or expired token. |
| `forbidden` / `not_owner` | 403 | No permission. |
| `rate_limited` | 429 | Over message limit. |
| `message_too_large` | 413 | Message over 4000 bytes. |
| `validation_error` | 422 | Body doesn't meet contract. |

---

## 12. Versioning

- Everything under `/api/v1`.
- Contract-breaking changes lead to `/api/v2`.
- Additive changes (new endpoint, optional field) don't version.

The API doesn't assume the client is a PC. A mobile client should generate its
types from OpenAPI without effort.

---

## 13. What still needs deciding

These are product questions, not implementation ones. Left open until you
resolve them:

1. ~~Kafka on the user's PC.~~ **Resolved:** every PC runs a complete Kafka.
   There is no embedded mode or local fallback. See `architecture.md` §4.
2. ~~Node with N servers vs node = 1 server.~~ **Resolved:** node holds N
   servers. See section 0.
3. ~~Shareable IP resolution.~~ **Resolved:** the node detects its addresses
   and returns `recommended` plus `candidates`; the client uses the
   recommendation and lets the owner override it.
4. **Server discovery.** See section 8.
5. **Where files live.** See section 9.
6. **Custom roles.** Needed, or are three roles enough for v1?
7. ~~Personal name vs nickname.~~ **Resolved:** nickname is per server and is
   requested first on join. There is no global personal name for now.
8. **Backup mechanism.** The 3-day window is decided; whether it is WAL/PITR
   or scheduled dumps is still open.
