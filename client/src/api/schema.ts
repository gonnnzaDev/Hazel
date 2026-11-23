import { z } from 'zod';

/** Esquemas derivados de docs/api.md y de rust/src/models/*.rs. */

export const roleSchema = z.enum(['member', 'admin', 'owner']);
export const channelKindSchema = z.enum(['text', 'voice']);
export const serverStatusSchema = z.enum(['creating', 'active', 'inactive', 'deleted']);

export const memberSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  display_name: z.string(),
  role: roleSchema,
  is_online: z.boolean(),
  last_seen_at: z.string().nullable(),
  joined_at: z.string(),
});

export const serverSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

export const joinResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string().nullable(),
  member: memberSchema,
  server: serverSummarySchema,
});

export const channelSchema = z.object({
  id: z.string(),
  server_id: z.string(),
  name: z.string(),
  kind: channelKindSchema,
  topic: z.string().nullable(),
  position: z.number(),
  is_default: z.boolean(),
});

export const inviteSchema = z.object({
  code: z.string(),
  server_id: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  single_use: z.boolean(),
  consumed: z.boolean(),
  has_password: z.boolean(),
});

export const serverSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: serverStatusSchema,
  max_members: z.number(),
  last_heartbeat_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  channels: z.array(channelSchema),
});

export const serverListSchema = z.object({
  items: z.array(serverSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const messageAuthorSchema = z.object({
  nickname: z.string(),
  display_name: z.string().nullable(),
});

export const reactionSchema = z.object({
  emoji: z.string(),
  nickname: z.string(),
});

export const messageSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  author: messageAuthorSchema,
  content: z.string().nullable(),
  reply_to: z.string().nullable(),
  attachments: z.array(z.string()),
  reactions: z.array(reactionSchema),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  deleted: z.boolean(),
});

export const messageListSchema = z.object({
  items: z.array(messageSchema),
  limit: z.number(),
  next_cursor: z.string().nullable(),
});

export const healthSchema = z.object({
  status: z.string(),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  timestamp: z.string(),
});
export const readySchema = z.object({
  status: z.string(),
  checks: z.record(z.unknown()),
});
export const tokenResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string().nullable(),
});
export const memberListSchema = z.object({
  items: z.array(memberSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export const serverStatsSchema = z.object({
  server_id: z.string(),
  members: z.number(),
  messages: z.number(),
  attachment_bytes: z.number(),
  db_bytes: z.number(),
  total_bytes: z.number(),
});
export const auditEventSchema = z.object({
  id: z.string(),
  server_id: z.string(),
  actor_nickname: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  data: z.record(z.unknown()),
  created_at: z.string(),
});
export const auditEventListSchema = z.object({
  items: z.array(auditEventSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export const backupSchema = z.object({
  backup_id: z.string(),
  path: z.string(),
  size: z.number(),
  created_at: z.string(),
});
export const attachmentSchema = z.object({
  id: z.string(),
  message_id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size: z.number(),
  storage_key: z.string(),
});
export const callParticipantsSchema = z.object({
  channel_id: z.string(),
  participants: z.array(
    z.object({
      member_id: z.string(),
      nickname: z.string(),
      display_name: z.string(),
      mic: z.boolean(),
      cam: z.boolean(),
    }),
  ),
  count: z.number(),
  max: z.number(),
});

export const nodeInfoSchema = z.object({
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  bind_host: z.string(),
  bind_port: z.number(),
  is_listening: z.boolean(),
  can_manage: z.boolean(),
  kafka_topic_prefix: z.string(),
});

export const nodeAddressSchema = z.object({
  port: z.number(),
  bind_host: z.string(),
  is_wildcard: z.boolean(),
  recommended: z.string().nullable(),
  candidates: z.array(
    z.object({
      host: z.string(),
      family: z.string(),
      private: z.boolean(),
      loopback: z.boolean(),
    }),
  ),
});

export const serverAddressSchema = z.object({
  server_id: z.string(),
  slug: z.string(),
  server_name: z.string(),
  is_active: z.boolean(),
  host: z.string().nullable(),
  port: z.number(),
  address: z.string().nullable(),
  node: nodeAddressSchema,
});

export const meSchema = z.object({
  member: memberSchema,
  server: serverSummarySchema,
});

/** RFC 9457 problem+json. Campos de dominio extra se conservan. */
export const problemSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().optional(),
    code: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

/** Sobre común de todos los eventos del WebSocket. */
export const eventSchema = z.object({
  type: z.string(),
  server_id: z.string(),
  channel_id: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});

export type Member = z.infer<typeof memberSchema>;
export type ServerSummary = z.infer<typeof serverSummarySchema>;
export type JoinResponse = z.infer<typeof joinResponseSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type Invite = z.infer<typeof inviteSchema>;
export type Server = z.infer<typeof serverSchema>;
export type ServerList = z.infer<typeof serverListSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageList = z.infer<typeof messageListSchema>;
export type NodeAddress = z.infer<typeof nodeAddressSchema>;
export type NodeInfo = z.infer<typeof nodeInfoSchema>;
export type Me = z.infer<typeof meSchema>;
export type HazelEvent = z.infer<typeof eventSchema>;
export type MemberList = z.infer<typeof memberListSchema>;
export type ServerStats = z.infer<typeof serverStatsSchema>;
export type ServerAddress = z.infer<typeof serverAddressSchema>;
export type AuditEventList = z.infer<typeof auditEventListSchema>;
export type Backup = z.infer<typeof backupSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type CallParticipants = z.infer<typeof callParticipantsSchema>;
