/**
 * Cliente REST del backend de Recop (`/api/v1`), listo para conectar.
 *
 * Hoy la app corre con datos de prueba (mocks/) y no lo usa. Para pasar al
 * backend real, los stores reemplazan sus acciones de prueba por estas
 * llamadas; los tipos de respuesta copian los schemas de Pydantic del backend
 * y `toMessage` los traduce a los tipos del dominio.
 *
 * Ojo con una diferencia de modelo: Recop no tiene cuentas globales. Cada
 * servidor te da un token propio al entrar con un nickname (`join`), así que
 * "login" en el backend real es entrar a un servidor.
 */

import type { Message } from './types';

const BASE_URL = process.env.EXPO_PUBLIC_RECOP_API_URL ?? 'http://192.168.1.50:7273';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
}

async function request<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    // Los errores de Recop son application/problem+json con `detail` en castellano.
    const problem = (data ?? {}) as { detail?: string; code?: string };
    throw new ApiError(problem.detail ?? `Error ${response.status}`, response.status, problem.code ?? 'error');
  }
  return data as T;
}

// ─── Formas del backend (apps/*/schemas.py) ───────────────────────────────────

export interface RecopChannel {
  id: string;
  name: string;
  kind: 'text' | 'voice';
  topic: string | null;
  position: number;
  is_default: boolean;
}

export interface RecopServer {
  id: string;
  name: string;
  slug: string;
  status: 'creating' | 'active' | 'inactive' | 'deleted';
  bind_port: number;
  channels: RecopChannel[];
}

export interface RecopMember {
  id: string;
  nickname: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
}

export interface RecopMessage {
  id: string;
  author_nickname: string;
  content: string;
  created_at: string;
}

interface Page<T> {
  items: T[];
  total: number;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const recopApi = {
  servers: () => request<Page<RecopServer>>('/servers?limit=100'),
  serverBySlug: (slug: string) => request<RecopServer>(`/servers/by-slug/${encodeURIComponent(slug)}`),
  join: (serverId: string, nickname: string, displayName?: string) =>
    request<{ token: string; member: RecopMember }>(`/servers/${serverId}/join`, {
      method: 'POST',
      body: { nickname, display_name: displayName },
    }),
  members: (serverId: string) => request<Page<RecopMember>>(`/servers/${serverId}/members?limit=200`),
  messages: (serverId: string, channelId: string, offset = 0) =>
    request<Page<RecopMessage>>(`/servers/${serverId}/channels/${channelId}/messages?limit=50&offset=${offset}`),
  send: (serverId: string, channelId: string, token: string, content: string) =>
    request<RecopMessage>(`/servers/${serverId}/channels/${channelId}/messages`, {
      method: 'POST',
      token,
      body: { content },
    }),
};

/** Un mensaje del backend como mensaje del dominio. */
export function toMessage(channelId: string, raw: RecopMessage): Message {
  return {
    id: raw.id,
    channelId,
    authorId: raw.author_nickname,
    content: raw.content,
    createdAt: Date.parse(raw.created_at),
    reactions: [],
    mentions: [],
  };
}
