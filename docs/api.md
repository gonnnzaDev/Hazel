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
| `[x]` | `PUT /api/v1/servers/{server_id}/members/{nickname}/role?role=admin` | Change a member's role. No body. Returns the updated member. |

A member stops being `member` and becomes `admin` with
`PUT .../role?role=admin`. The only accepted query values are `member` and
`admin`; anything else returns 422 `invalid_role` with
`{"allowed": ["member", "admin"]}`.

### Base roles

Roles are stored as numbers (`member=10`, `admin=50`, `owner=100`) because
permissions compare rank; the API speaks words (`"role": "admin"` in member
responses), so a client doesn't need to know that admin is 50.

| Role | Can |
|---|---|
| `owner` | Everything, including deleting the server. Assigned to the first member; can't be removed or handed off via API (`owner_role_immutable`). |
| `admin` | Manage channels, members and roles. Can't delete the server. |
| `member` | Chat. Default role for anyone joining. |

Rules enforced by the service layer:

- only an admin or owner can change roles or kick (`not_admin`);
- nobody can kick someone with an equal or higher role (`role_hierarchy`), nor
  themselves (`cannot_kick_self`);
- the owner can leave on their own, but no one can kick them;
- changing to or from `owner` is rejected (`owner_role_immutable`).

Custom roles are not implemented. The permission model stays open for you to define.

---

## 5. Channels

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/servers/{server_id}/channels` | Create channel. |
| `[x]` | `GET /api/v1/servers/{server_id}/channels` | List channels. |
| `[x]` | `GET /api/v1/servers/{server_id}/channels/{channel_id}` | See a channel. |
| `[x]` | `PATCH /api/v1/servers/{server_id}/channels/{channel_id}` | Edit. |
| `[x]` | `DELETE /api/v1/servers/{server_id}/channels/{channel_id}` | Delete. |
| `[x]` | `POST /api/v1/servers/{server_id}/channels/{channel_id}/join` | Join channel (open socket). |

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
| `[x]` | `WS /api/v1/ws?token=<token>` | Event channel. |

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
| `node.state_changed` | Node/group process lifecycle. Data: `state` (`up`, `down`, `group_up`, `group_down`), `reason` and, for group states, `server_id`. |
| `channel.subscribed` | The server accepted a `channel.subscribe` request. |
| `channel.unsubscribed` | The subscription was removed. |
| `heartbeat` | Acknowledgement of a client heartbeat. Data: `server_time`. |
| `error` | A client event was invalid. Data: `code`, `detail`. |

`message.updated`, `message.deleted`, `reaction.added`, `reaction.removed` and
`server.updated` are emitted through the outbox. `node.state_changed` is emitted
by the supervisor hooks: node start/stop (`up`/`down`) and group spawn,
termination or unexpected exit (`group_up`/`group_down`). Because the envelope
needs a `server_id`, a node-level event is delivered once per server that has
local sockets.

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

### Realtime rules (decided)

- **Presence is the socket line.** Connecting a socket marks the member online;
  closing every socket of a member marks it offline. Each transition is one
  server-wide `presence.update`; a member with two open sockets transitions
  once (no per-socket noise). No heartbeats update presence, only the traffic
  line does.
- **`typing.start` reaches only the channel's subscribers** and requires the
  sender to be subscribed too; it is never persisted. One socket admits up to
  `HAZEL_TYPING_RATE_PER_MINUTE` (default 15) typing events per minute; extra
  ones are ignored silently.
- **Heartbeat answers `{"type": "heartbeat"}`.** A socket that sends nothing
  for `HAZEL_WEBSOCKET_IDLE_TIMEOUT_SECONDS` (default 300) is closed cleanly.
- **Per-socket queues are bounded** (`HAZEL_WEBSOCKET_QUEUE_SIZE`, default
  128). A consumer too slow to drain its queue is closed instead of eating
  memory or blocking the bus.
- **`message.*` and `reaction.*` payloads carry the full message** in the same
  shape as `GET /messages/{id}` (`message.deleted` carries only the id), so a
  client can refresh without a second round trip.
- **Delivery rides the outbox**: events are written in the same transaction as
  the change and fan out after the commit, at-least-once. There is no replay for
  disconnected clients in v1 (no retained history of events).
- **Cross-process delivery rides Kafka**: after the local fan-out, the outbox
  publishes the same envelope to `hazel.events`. Every process runs a consumer
  with its own consumer group, so a socket on the node sees events produced in a
  group process (and the other way around). Messages from the producing process
  are skipped to avoid an echo. `HAZEL_KAFKA_FANOUT_ENABLED=false` turns it off
  for local development; `/health/ready` reports `ok`, `disabled` or `error`.
- **`server.state_changed`** is emitted from the servers service lifecycle
  (activate / deactivate / delete). **`server.updated`** is emitted by
  `PATCH /servers/{id}`. **`node.state_changed`** is emitted from the node
  supervisor hooks (`src/core/supervisor.py`).

---

## 7.1. Calls (voice)

Voice uses its own WebRTC signaling sockets. There is no media server: peers
connect to each other (full mesh), so upload bandwidth grows with the square
of the headcount.

| Method | Route | What it does |
|---|---|---|
| `[x]` | `WS /api/v1/servers/{server_id}/channels/{channel_id}/call?token=<token>` | Join the call's signaling room. |
| `[x]` | `GET /api/v1/servers/{server_id}/channels/{channel_id}/call/participants` | Who is in the room. Requires `Bearer <token>`. |

### Signalling socket

The token goes in the query string, as in `/ws`, and is authenticated once at
connect time. Invalid, expired, foreign-server, unknown-channel or malformed
targets close with code `1008` (reason is the error code, e.g.
`missing_token`, `wrong_server`, `channel_not_found`). The channel must belong
to the server in the path.

On join the server sends:

```json
{
  "type": "welcome",
  "you": "01a1...",
  "peers": [
    { "member_id": "01a1...", "nickname": "ana", "display_name": "Ana", "mic": true, "cam": false }
  ],
  "ice_servers": []
}
```

`ice_servers` comes from `HAZEL_CALL_ICE_SERVERS` (STUN/TURN list, empty by
default); Hazel doesn't depend on any external service for a LAN call. Other
peers receive `peer-joined` with the same peer shape; on disconnect they get
`{"type": "peer-left", "member_id": "..."}`.

Client frames are JSON. Unknown types and malformed JSON are ignored — they
never drop the socket.

| Frame | Effect |
|---|---|
| `{"type":"offer","to":"<member_id>","sdp":{...}}` | Forwarded to that peer as `{"type":"offer","from":"<member_id>","payload":{...}}`. |
| `{"type":"answer","to":"<member_id>","sdp":{...}}` | Same, with type `answer`. |
| `{"type":"ice","to":"<member_id>","candidate":{...}}` | Same, with type `ice` and the candidate as payload. |
| `{"type":"state","mic":true,"cam":false}` | Updates your peer state and broadcasts `peer-state` to the other peers. |

### Participants

```json
{
  "channel_id": "01a1...",
  "participants": [
    { "member_id": "01a1...", "nickname": "ana", "display_name": "Ana", "mic": true, "cam": false }
  ],
  "count": 1,
  "max": 16
}
```

`max` is `HAZEL_CALL_MAX_PARTICIPANTS` (default 16). **The cap is reported but
not enforced yet**: a room accepts every peer that connects. Rooms and peer
state live in process memory only (`src/calls/repository.py`), so they are lost
on restart and are not shared between the node and group processes.

---

## 8. Invites and discovery

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/servers/{server_id}/invites` | Create invite. Admin/owner only. Body: `{ "ttl_seconds": 300, "single_use": false }`. |
| `[x]` | `GET /api/v1/invites/{code}` | See/validate invite; consumes single-use invites. |
| `[x]` | `DELETE /api/v1/invites/{code}` | Revoke. |

Invites are temporary: `ttl_seconds` (60–604800) sets the lifetime, `single_use`
flags one-shot consumption. Only admins/owners can create them. Redeeming an
invite is followed by the nickname join flow (`POST /servers/{server_id}/join`),
which validates nickname availability per server.

**Decision resolved:** discovery is by invite codes (**option B**). See §13.

---

## 9. Files

| Method | Route | What it does |
|---|---|---|
| `[x]` | `POST /api/v1/channels/{channel_id}/attachments` | Upload. |
| `[x]` | `GET /api/v1/attachments/{attachment_id}` | Download. |
| `[x]` | `DELETE /api/v1/attachments/{attachment_id}` | Delete. |

> **Decision resolved:** files live on the node's local disk, under
> `HAZEL_STORAGE_ROOT`. No S3-compatible storage in v1: a self-hosted node keeps
> the owner's data on the owner's PC, capped by its free space.

---

## 10. Maintenance

| Method | Route | What it does |
|---|---|---|
| `[x]` | `GET /api/v1/servers/{server_id}/stats` | Members, messages, size. |
| `[x]` | `POST /api/v1/servers/{server_id}/backup` | Backup to file. |
| `[x]` | `POST /api/v1/servers/{server_id}/restore` | Restore from backup. |
| `[x]` | `GET /api/v1/servers/{server_id}/events` | Audit. |

This isn't secondary: it's what gives the owner confidence their data is on
their PC and recoverable. `POST /backup` runs `pg_dump --format=custom` and
stores a `.dump` plus a small JSON manifest under
`HAZEL_STORAGE_ROOT/backups/{server_id}/`. Backups older than
`HAZEL_BACKUP_RETENTION_DAYS` (default 3) are pruned on each new backup.
`POST /restore` validates the manifest's `server_id` and runs `pg_restore
--clean --if-exists`. The runtime image includes `postgresql-client` for both
tools.

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
  "state": "inactive"
}
```

`status` is always the HTTP status number. Domain errors add context fields
(`server_id`, `state`, `channel_id`, `errors`, etc.) at the top level.

### Catalog

Codes actually emitted by the API, grouped by HTTP status.

| `code` | HTTP | When |
|---|---|---|
| `unauthenticated` | 401 | Default for a missing/invalid token. |
| `missing_token` | 401 | No token on a protected socket (`/ws`, calls) or service call. |
| `invalid_token` | 401 | Token is malformed, revoked or expired. |
| `invalid_admin_token` | 401 | Wrong/missing node administration token. |
| `forbidden` | 403 | Default permission error. |
| `wrong_server` | 403 | Token belongs to a different server than the path. |
| `not_admin` | 403 | Action requires admin or owner. |
| `owner_required` | 403 | Only the node owner can do this (e.g. delete group). |
| `role_hierarchy` | 403 | Kicking someone with an equal or higher role. |
| `owner_role_immutable` | 403 | Trying to assign or remove the owner role. |
| `not_message_author` | 403 | Editing someone else's message. |
| `not_found` | 404 | Default for a missing resource. |
| `server_not_found` | 404 | Server doesn't exist. |
| `server_not_found_by_slug` | 404 | No server with that identifier. |
| `member_not_found` / `member_not_found_by_nickname` | 404 | Member missing. |
| `channel_not_found` | 404 | Channel missing or belongs to another server. |
| `message_not_found` | 404 | Message missing. |
| `attachment_not_found` | 404 | Attachment missing. |
| `invite_not_found` | 404 | Invite code doesn't exist. |
| `backup_not_found` | 404 | `backup_id` or path doesn't exist. |
| `call_target_not_found` | 404 | Malformed server/channel id on the call socket. |
| `server_inactive` | 409 | Tried to use a turned-off server. |
| `server_deleted` | 409 | Tried to use a deleted server. |
| `invalid_state_transition` | 409 | Impossible lifecycle transition. |
| `conflict` | 409 | Default conflict. |
| `slug_taken` | 409 | Identifier already exists. |
| `nickname_taken` | 409 | Nickname already exists on that server. |
| `channel_name_taken` | 409 | Channel name already exists on that server. |
| `default_channel` | 409 | The default channel can't be deleted. |
| `message_deleted` | 409 | Replying to or reacting on a deleted message. |
| `invite_invalid` | 409 | Single-use invite already consumed. |
| `no_free_port` | 409 | No port left in the node's group port range. |
| `not_the_node` | 409 | Group management called on a non-node process. |
| `invite_expired` | 410 | Invite TTL passed. |
| `message_too_large` | 413 | Message over 4000 bytes. |
| `attachment_too_large` | 413 | Upload over the configured limit. |
| `rate_limited` | 429 | Over the per-nickname message limit. |
| `nickname_reserved` | 422 | Nickname is on the reserved list. |
| `nickname_invalid_charset` | 422 | Disallowed characters. |
| `nickname_too_short` / `nickname_too_long` | 422 | Length out of range. |
| `request_validation_error` | 422 | FastAPI request validation; includes `errors`. |
| `validation_error` / `domain_validation_error` | 422 | Body or domain rule doesn't meet the contract. |
| `cannot_kick_self` | 422 | Use "leave the server" instead. |
| `invalid_role` | 422 | Unknown `?role=`; includes `allowed`. |
| `invalid_slug` | 422 | Slug normalizes to empty. |
| `reply_target_invalid` / `reply_target_deleted` | 422 | Bad `reply_to`. |
| `invalid_restore_request` / `invalid_backup_path` / `invalid_backup_file` / `backup_server_mismatch` | 422 | Backup validation failed. |
| `backup_requires_postgres` | 422 | Backup requested on a non-PostgreSQL database. |
| `backup_tool_failed` | 500 | `pg_dump` or `pg_restore` exited with an error. |
| `internal_error` | 500 | Unhandled error. |

`port_taken` and `not_owner` were in an earlier version of this catalog but
are never emitted: the node allocates ports itself (`no_free_port` when the
range is exhausted) and owner checks report `owner_required` or
`role_hierarchy`. Starlette HTTP exceptions use `http_<status>` instead.

---

## 12. Versioning

- Everything under `/api/v1`.
- Contract-breaking changes lead to `/api/v2`.
- Additive changes (new endpoint, optional field) don't version.

The API doesn't assume the client is a PC. A mobile client should generate its
types from OpenAPI without effort.

---

## 13. What still needs deciding

All the product questions from earlier revisions are now resolved:

1. ~~Kafka on the user's PC.~~ **Resolved:** every PC runs a complete Kafka.
   There is no embedded mode or local fallback. See `architecture.md` §4.
2. ~~Node with N servers vs node = 1 server.~~ **Resolved:** node holds N
   servers. See section 0.
3. ~~Shareable IP resolution.~~ **Resolved:** the node detects its addresses
   and returns `recommended` plus `candidates`; the client uses the
   recommendation and lets the owner override it.
4. ~~Server discovery.~~ **Resolved:** invite codes (option B). Invites are
   temporary (`ttl_seconds`) and admin/owner-only. See section 8.
5. ~~Where files live.~~ **Resolved:** local disk under `HAZEL_STORAGE_ROOT`.
   See section 9.
6. ~~Custom roles.~~ **Resolved:** three roles (`member`, `admin`, `owner`) are
   enough for v1; custom roles come later. See section 4.
7. ~~Personal name vs nickname.~~ **Resolved:** nickname is per server and is
   requested first on join. There is no global personal name for now.
8. ~~Backup mechanism.~~ **Resolved:** scheduled logical dumps with
   `pg_dump`/`pg_restore` and a 3-day retention window, not WAL/PITR. See
   section 10.
