import { z, type ZodType } from 'zod';
import { readError } from './errors';
import {
  joinResponseSchema,
  meSchema,
  messageListSchema,
  messageSchema,
  nodeAddressSchema,
  serverListSchema,
  serverSchema,
  type JoinResponse,
  type Me,
  type Message,
  type MessageList,
  type NodeAddress,
  type Server,
  type ServerList,
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

  getNodeAddress(): Promise<NodeAddress> {
    return this.request('GET', '/node/address', nodeAddressSchema);
  }

  listServers(): Promise<ServerList> {
    return this.request('GET', '/servers?limit=100', serverListSchema);
  }

  getServer(serverId: string): Promise<Server> {
    return this.request('GET', `/servers/${serverId}`, serverSchema);
  }

  /** Crear servidor requiere el token de administración del nodo. */
  createServer(
    payload: {
      name: string;
      slug: string;
      description?: string | null;
      owner_nickname: string;
    },
    adminToken: string,
  ): Promise<Server> {
    return this.request('POST', '/servers', serverSchema, payload, adminToken);
  }

  join(serverId: string, nickname: string, displayName?: string): Promise<JoinResponse> {
    return this.request('POST', `/servers/${serverId}/join`, joinResponseSchema, {
      nickname,
      display_name: displayName ?? null,
    });
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
}
