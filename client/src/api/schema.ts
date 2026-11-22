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
export type Server = z.infer<typeof serverSchema>;
export type ServerList = z.infer<typeof serverListSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageList = z.infer<typeof messageListSchema>;
export type NodeAddress = z.infer<typeof nodeAddressSchema>;
export type Me = z.infer<typeof meSchema>;
export type HazelEvent = z.infer<typeof eventSchema>;
