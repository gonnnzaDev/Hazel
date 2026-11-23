import { z, type ZodType } from 'zod';
import { readError } from './errors';
import {
  attachmentSchema,
  auditEventListSchema,
  backupSchema,
  callParticipantsSchema,
  channelSchema,
  healthSchema,
  inviteSchema,
  memberListSchema,
  joinResponseSchema,
  meSchema,
  memberSchema,
  type Channel,
  type Invite,
  type Member,
  messageListSchema,
  messageSchema,
  nodeAddressSchema,
  nodeInfoSchema,
  readySchema,
  serverAddressSchema,
  serverListSchema,
  serverSchema,
  serverStatsSchema,
  tokenResponseSchema,
  type Attachment,
  type AuditEventList,
  type Backup,
  type CallParticipants,
  type JoinResponse,
  type Me,
  type MemberList,
  type Message,
  type MessageList,
  type NodeAddress,
  type NodeInfo,
  type Server,
  type ServerAddress,
  type ServerList,
  type ServerStats,
} from './schema';

export const API_PREFIX = '/api/v1';

export class HazelClient {
  constructor(
    public baseUrl: string,
    public token?: string,
  ) {}

  setToken(token?: string) {
    this.token = token;
  }

  setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private url(path: string): string {
    return `${this.baseUrl}${API_PREFIX}${path}`;
  }

  async request<T>(
    method: string,
    path: string,
    schema: ZodType<T>,
    body?: unknown,
    tokenOverride?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const auth = tokenOverride ?? this.token;
    if (auth) headers.Authorization = `Bearer ${auth}`;

    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new TypeError('No se pudo conectar con el nodo');
    }

    if (!response.ok) throw await readError(response);
    if (response.status === 204) return undefined as T;

    const raw: unknown = await response.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Respuesta inesperada en ${path}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  getNodeInfo(): Promise<NodeInfo> {
    return this.request('GET', '/node', nodeInfoSchema);
  }

  getNodeAddress(): Promise<NodeAddress> {
    return this.request('GET', '/node/address', nodeAddressSchema);
  }

  async health(): Promise<z.infer<typeof healthSchema>> {
    const response = await fetch(`${this.baseUrl}/health`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw await readError(response);
    return healthSchema.parse(await response.json());
  }

  async readiness(): Promise<z.infer<typeof readySchema>> {
    const response = await fetch(`${this.baseUrl}/health/ready`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw await readError(response);
    return readySchema.parse(await response.json());
  }

  listServers(): Promise<ServerList> {
    return this.request('GET', '/servers?limit=100', serverListSchema);
  }

  getServer(serverId: string): Promise<Server> {
    return this.request('GET', `/servers/${serverId}`, serverSchema);
  }

  getServerBySlug(slug: string): Promise<Server> {
    return this.request('GET', `/servers/by-slug/${encodeURIComponent(slug)}`, serverSchema);
  }

  /** Crear servidor requiere el token de administración del nodo. */
  createServer(
    payload: {
      name: string;
      slug: string;
      description?: string | null;
      owner_name: string;
    },
    adminToken: string,
  ): Promise<Server> {
    return this.request('POST', '/servers', serverSchema, payload, adminToken);
  }

  updateServer(
    serverId: string,
    payload: { name?: string; description?: string | null; max_members?: number },
  ): Promise<Server> {
    return this.request('PATCH', `/servers/${serverId}`, serverSchema, payload);
  }

  setServerStatus(serverId: string, active: boolean): Promise<Server> {
    return this.request('POST', `/servers/${serverId}/${active ? 'activate' : 'deactivate'}`, serverSchema);
  }

  /** Borra el servidor del nodo (solo disponible desde la máquina anfitriona). */
  deleteServer(serverId: string): Promise<void> {
    return this.request('DELETE', `/servers/${serverId}`, z.undefined());
  }

  heartbeat(serverId: string): Promise<Server> {
    return this.request('POST', `/servers/${serverId}/heartbeat`, serverSchema);
  }

  getServerAddress(serverId: string): Promise<ServerAddress> {
    return this.request('GET', `/servers/${serverId}/address`, serverAddressSchema);
  }

  getServerStats(serverId: string): Promise<ServerStats> {
    return this.request('GET', `/servers/${serverId}/stats`, serverStatsSchema);
  }

  listAuditEvents(serverId: string, limit = 50): Promise<AuditEventList> {
    return this.request('GET', `/servers/${serverId}/events?limit=${limit}`, auditEventListSchema);
  }

  createBackup(serverId: string): Promise<Backup> {
    return this.request('POST', `/servers/${serverId}/backup`, backupSchema);
  }

  restoreBackup(serverId: string, backupId: string): Promise<void> {
    return this.request('POST', `/servers/${serverId}/restore`, z.undefined(), { backup_id: backupId });
  }

  listChannels(serverId: string): Promise<Channel[]> {
    // La lista de canales ya viene en el servidor; este método es para refrescar.
    return this.request('GET', `/servers/${serverId}/channels`, z.array(channelSchema));
  }

  createChannel(
    serverId: string,
    payload: { name: string; kind: 'text' | 'voice'; topic?: string | null; position?: number },
  ): Promise<Channel> {
    return this.request('POST', `/servers/${serverId}/channels`, channelSchema, payload);
  }

  updateChannel(
    serverId: string,
    channelId: string,
    payload: { name?: string; topic?: string | null; position?: number },
  ): Promise<Channel> {
    return this.request('PATCH', `/servers/${serverId}/channels/${channelId}`, channelSchema, payload);
  }

  deleteChannel(serverId: string, channelId: string): Promise<void> {
    return this.request('DELETE', `/servers/${serverId}/channels/${channelId}`, z.undefined());
  }

  createInvite(
    serverId: string,
    payload: { ttl_seconds?: number; single_use?: boolean; password?: string | null },
  ): Promise<Invite> {
    return this.request('POST', `/servers/${serverId}/invites`, inviteSchema, payload);
  }

  getInvite(code: string): Promise<Invite> {
    return this.request('GET', `/invites/${encodeURIComponent(code)}`, inviteSchema);
  }

  deleteInvite(code: string): Promise<void> {
    return this.request('DELETE', `/invites/${encodeURIComponent(code)}`, z.undefined());
  }

  listMembers(serverId: string): Promise<MemberList> {
    return this.request('GET', `/servers/${serverId}/members`, memberListSchema);
  }

  getMember(serverId: string, nickname: string): Promise<Member> {
    return this.request('GET', `/servers/${serverId}/members/${encodeURIComponent(nickname)}`, memberSchema);
  }

  kickMember(serverId: string, nickname: string): Promise<void> {
    return this.request('DELETE', `/servers/${serverId}/members/${encodeURIComponent(nickname)}`, z.undefined());
  }

  join(serverId: string, name: string): Promise<JoinResponse> {
    return this.request('POST', `/servers/${serverId}/join`, joinResponseSchema, { name });
  }

  /** Abandona el servidor con el token de esa membresía. */
  leave(serverId: string): Promise<void> {
    return this.request('POST', `/servers/${serverId}/leave`, z.undefined());
  }

  /** Cambia el nombre público del miembro actual. */
  updateName(name: string): Promise<Member> {
    return this.request('PATCH', '/me', memberSchema, { name });
  }

  me(): Promise<Me> {
    return this.request('GET', '/me', meSchema);
  }

  listMessages(channelId: string, before?: string): Promise<MessageList> {
    const query = new URLSearchParams({ limit: '50' });
    if (before) query.set('before', before);
    return this.request('GET', `/channels/${channelId}/messages?${query}`, messageListSchema);
  }

  sendMessage(channelId: string, content: string, replyTo?: string): Promise<Message> {
    return this.request('POST', `/channels/${channelId}/messages`, messageSchema, {
      content,
      reply_to: replyTo ?? null,
      attachments: [],
    });
  }

  async logout(): Promise<void> {
    await this.request('POST', '/auth/logout', z.undefined());
  }

  refreshToken(): Promise<z.infer<typeof tokenResponseSchema>> {
    return this.request('POST', '/auth/refresh', tokenResponseSchema);
  }

  logoutAll(): Promise<void> {
    return this.request('POST', '/auth/logout-all', z.undefined());
  }

  joinChannel(channelId: string): Promise<void> {
    return this.request('POST', `/channels/${channelId}/join`, z.undefined());
  }

  getMessage(channelId: string, messageId: string): Promise<Message> {
    return this.request('GET', `/channels/${channelId}/messages/${messageId}`, messageSchema);
  }

  editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    return this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, messageSchema, { content });
  }

  deleteMessage(channelId: string, messageId: string): Promise<void> {
    return this.request('DELETE', `/channels/${channelId}/messages/${messageId}`, z.undefined());
  }

  addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    return this.request('POST', `/channels/${channelId}/messages/${messageId}/reactions`, z.undefined(), { emoji });
  }

  removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    return this.request(
      'DELETE',
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      z.undefined(),
    );
  }

  /** Sube un archivo adjunto usando multipart/form-data. */
  async uploadAttachment(channelId: string, messageId: string, file: File): Promise<Attachment> {
    const form = new FormData();
    form.append('attachment_message_id', messageId);
    form.append('file', file, file.name);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await fetch(`${this.url(`/channels/${channelId}/attachments`)}`, {
        method: 'POST',
        headers,
        body: form,
      });
    } catch {
      throw new TypeError('No se pudo conectar con el nodo');
    }
    if (!response.ok) throw await readError(response);
    return attachmentSchema.parse(await response.json());
  }

  /** Descarga un adjunto; el backend exige el token de miembro. */
  async downloadAttachment(attachmentId: string): Promise<Blob> {
    const headers: Record<string, string> = { Accept: '*/*' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url(`/attachments/${attachmentId}`), { headers });
    if (!response.ok) throw await readError(response);
    return response.blob();
  }

  deleteAttachment(attachmentId: string): Promise<void> {
    return this.request('DELETE', `/attachments/${attachmentId}`, z.undefined());
  }

  getCallParticipants(serverId: string, channelId: string): Promise<CallParticipants> {
    return this.request('GET', `/servers/${serverId}/channels/${channelId}/call/participants`, callParticipantsSchema);
  }
}
