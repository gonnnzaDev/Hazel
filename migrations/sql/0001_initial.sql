-- Hazel — esquema inicial (equivalente SQL a la cadena de migraciones de Alembic).
--
-- Se aplica con `python -m composer migrate`. El composer lleva el control en
-- `_composer_migrations`, así que este archivo se ejecuta una sola vez.
-- Todo es IF NOT EXISTS para que también sirva sobre una BD ya migrada.

DO $$
BEGIN
    CREATE TYPE server_status AS ENUM ('creating', 'active', 'inactive', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE channel_kind AS ENUM ('text', 'voice');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Servidores y canales ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS servers (
    id                uuid PRIMARY KEY,
    name              varchar(64) NOT NULL,
    slug              varchar(64) NOT NULL,
    description       text,
    status            server_status NOT NULL,
    bind_port         integer NOT NULL CHECK (bind_port BETWEEN 1 AND 65535),
    max_members       smallint NOT NULL CHECK (max_members > 0),
    last_heartbeat_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    ALTER TABLE servers ADD CONSTRAINT uq_servers_slug UNIQUE (slug);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_servers_status ON servers (status);

CREATE TABLE IF NOT EXISTS channels (
    id         uuid PRIMARY KEY,
    server_id  uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    name       varchar(64) NOT NULL,
    kind       channel_kind NOT NULL,
    topic      varchar(255),
    position   integer NOT NULL,
    is_default boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_channels_server_id_name UNIQUE (server_id, name)
);

CREATE INDEX IF NOT EXISTS ix_channels_server_id ON channels (server_id);
CREATE INDEX IF NOT EXISTS ix_channels_server_id_position ON channels (server_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_server_default
    ON channels (server_id) WHERE is_default;

-- ─── Identidad ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS members (
    id           uuid PRIMARY KEY,
    server_id    uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    nickname     varchar(32) NOT NULL,
    display_name varchar(64) NOT NULL,
    role         smallint NOT NULL,
    is_online    boolean NOT NULL,
    last_seen_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_members_server_id_nickname UNIQUE (server_id, nickname)
);

CREATE INDEX IF NOT EXISTS ix_members_server_id ON members (server_id);
CREATE INDEX IF NOT EXISTS ix_members_server_id_role ON members (server_id, role);

CREATE TABLE IF NOT EXISTS member_tokens (
    id           uuid PRIMARY KEY,
    member_id    uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    server_id    uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    token_hash   varchar(64) NOT NULL,
    expires_at   timestamptz,
    revoked_at   timestamptz,
    last_used_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_member_tokens_member_id ON member_tokens (member_id);
CREATE INDEX IF NOT EXISTS ix_member_tokens_server_id ON member_tokens (server_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_member_tokens_token_hash ON member_tokens (token_hash);

-- ─── Mensajes ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id               uuid PRIMARY KEY,
    channel_id       uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    author_nickname  varchar(64) NOT NULL,
    author_member_id uuid REFERENCES members (id) ON DELETE SET NULL,
    content          text NOT NULL,
    reply_to         uuid REFERENCES messages (id) ON DELETE SET NULL,
    attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
    edited_at        timestamptz,
    deleted_at       timestamptz,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_messages_channel_id ON messages (channel_id);
CREATE INDEX IF NOT EXISTS ix_messages_channel_id_created_at ON messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS ix_messages_author_member_id_created_at
    ON messages (author_member_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
    id         uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    member_id  uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    emoji      varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reactions_message_member_emoji UNIQUE (message_id, member_id, emoji)
);

CREATE INDEX IF NOT EXISTS ix_reactions_message_id ON reactions (message_id);

CREATE TABLE IF NOT EXISTS attachments (
    id           uuid PRIMARY KEY,
    message_id   uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    filename     varchar(255) NOT NULL,
    content_type varchar(255) NOT NULL,
    size         integer NOT NULL,
    storage_key  varchar(512) NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_attachments_message_id ON attachments (message_id);

-- ─── Eventos e invitaciones ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outbox_events (
    id         uuid PRIMARY KEY,
    event_type varchar(64) NOT NULL,
    server_id  uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    channel_id uuid REFERENCES channels (id) ON DELETE CASCADE,
    data       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_outbox_events_server_id_id ON outbox_events (server_id, id);

CREATE TABLE IF NOT EXISTS audit_events (
    id             uuid PRIMARY KEY,
    server_id      uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    actor_nickname varchar(64),
    action         varchar(128) NOT NULL,
    target_type    varchar(64),
    target_id      varchar(64),
    data           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_audit_events_server_id ON audit_events (server_id);
CREATE INDEX IF NOT EXISTS ix_audit_events_action ON audit_events (action);

CREATE TABLE IF NOT EXISTS invites (
    id            uuid PRIMARY KEY,
    code          varchar(16) NOT NULL,
    server_id     uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    created_by    varchar(64) NOT NULL,
    created_at    timestamptz NOT NULL,
    expires_at    timestamptz NOT NULL,
    single_use    boolean NOT NULL DEFAULT false,
    consumed      boolean NOT NULL DEFAULT false,
    password_hash varchar(255)
);

CREATE INDEX IF NOT EXISTS ix_invites_server_id ON invites (server_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_invites_code ON invites (code);
