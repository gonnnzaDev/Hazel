// Cliente HTTP de la API de Hazel (`/api/v1`).
//
// Todo pasa por la dirección del NODO (por defecto http://127.0.0.1:7272): el
// nodo sirve la API completa, la del dueño (crear, encender, apagar y borrar
// servidores) y la de cada servidor (entrar con un nickname, miembros, roles y
// la señalización de las llamadas). Para entrar al servidor de otra persona se
// usa la dirección de SU nodo.
//
// Por eso cada función recibe la dirección base: no hay "un" servidor.

import type { ProxyRequest, ProxyResponse } from '../../shared/bridge';
import type {
  CallParticipants,
  JoinRequest,
  JoinResponse,
  Member,
  MeResponse,
  NodeAddress,
  NodeInfo,
  Page,
  Role,
  Server,
  ServerAddress,
  ServerCreate,
} from './types';

const DEFAULT_TIMEOUT_MS = 10_000;
// Crear un servidor es levantar un proceso: el nodo espera hasta 20 s.
const SPAWN_TIMEOUT_MS = 30_000;

/** `status` 0 es un error de red; -1, un error que no vino de HTTP. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: unknown;

  constructor(
    message: string,
    { status = -1, code = 'error', data = null }: { status?: number; code?: string; data?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

// Cualquier error como `ApiError`, para poder preguntarle `status` o `code`
// sin revisar de qué tipo es cada vez.
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(error instanceof Error ? error.message : 'Algo salió mal.');
}

// En Electron la petición la hace el proceso principal (ver src/main/main.ts);
// en un navegador, `fetch` directo.
async function transport(
  request: Required<Pick<ProxyRequest, 'url' | 'method' | 'headers' | 'timeoutMs'>> & ProxyRequest,
): Promise<ProxyResponse> {
  if (window.hazelBridge) return window.hazelBridge.request(request);

  const { url, method, headers, body, timeoutMs } = request;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

// El cuerpo de un error de la API: `application/problem+json` (RFC 9457).
interface Problem {
  code?: string;
  detail?: string;
  errors?: { msg?: string }[];
}

// Convierte una respuesta de error en un mensaje para la gente. El backend ya
// escribe `detail` en castellano; acá solo se cubren los casos en que no lo hay.
function errorFrom(status: number, data: Problem | null): ApiError {
  const code = data?.code ?? `http_${status}`;

  const first = data?.errors?.[0];
  if (code === 'request_validation_error' && first) {
    const message = String(first.msg ?? '').replace(/^Value error,\s*/i, '');
    return new ApiError(message || 'Revisá los datos e intentá de nuevo.', { status, code, data });
  }

  if (data?.detail) return new ApiError(String(data.detail), { status, code, data });
  if (status === 401) return new ApiError('Tu sesión venció. Volvé a entrar.', { status, code, data });
  if (status === 404) return new ApiError('No se encontró lo que buscabas.', { status, code, data });
  return new ApiError(`El servidor respondió con un error (${status}).`, { status, code, data });
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** La ruta va tal cual, sin el prefijo `/api/v1` (para `/health`). */
  raw?: boolean;
}

async function request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, query, timeoutMs = DEFAULT_TIMEOUT_MS, raw = false } = options;

  const url = new URL(raw ? path : `/api/v1${path}`, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await transport({
    url: url.toString(),
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
  });

  if (response.status === 0) {
    const host = hostOf(baseUrl);
    const message =
      response.error === 'timeout'
        ? `${host} tardó demasiado en responder.`
        : `No se pudo conectar con ${host}. Revisá que esté encendido y que la dirección sea correcta.`;
    throw new ApiError(message, { status: 0, code: response.error ?? 'network' });
  }

  let data: unknown = null;
  if (response.body) {
    try {
      data = JSON.parse(response.body);
    } catch {
      data = null;
    }
  }

  if (!response.ok) throw errorFrom(response.status, data as Problem | null);
  return data as T;
}

// ─── Direcciones ──────────────────────────────────────────────────────────────

export interface Address {
  baseUrl: string;
  host: string;
  port: number;
  slug: string | null;
}

<<<<<<< HEAD:front/src/renderer/api.ts
// Lo que la gente pega para unirse: "192.168.1.50:7273/casa-de-luis".
// También acepta "http://…" y "hazel://…", y el slug es opcional.
=======
// Lo que la gente pega para unirse: "192.168.1.50:7272/casa-de-luis".
// También acepta "http://…" y "hazel://…", y el slug es opcional.
>>>>>>> pr-19:front/src/renderer/lib/api.ts
export function parseAddress(input: string): Address {
  let value = input.trim();
  if (!value) throw new ApiError('Escribí la dirección que te pasaron.');

  value = value.replace(/^(hazel|https?):\/\//i, '');
  const [hostPort = '', ...rest] = value.split('/');
  const slug = rest.find(Boolean) ?? null;

  const match = hostPort.match(/^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/);
  const host = match?.[1];
  if (!match || !host) {
    throw new ApiError('La dirección tiene que tener la forma ip:puerto, por ejemplo 192.168.1.50:7272.');
  }

  const port = Number(match[2]);
  if (port < 1 || port > 65535) throw new ApiError('El puerto tiene que estar entre 1 y 65535.');

  return { baseUrl: `http://${host}:${port}`, host, port, slug };
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

// Nodo

export const nodeInfo = (base: string) => request<NodeInfo>(base, '/node', { timeoutMs: 4000 });

export const nodeAddress = (base: string) => request<NodeAddress>(base, '/node/address');

/** Latencia real hasta un nodo, en milisegundos: ida y vuelta de `/health`. */
export async function ping(base: string): Promise<number> {
  const started = performance.now();
  await request<unknown>(base, '/health', { raw: true, timeoutMs: 4000 });
  return performance.now() - started;
}

export const listServers = (base: string) =>
  request<Page<Server>>(base, '/servers', { query: { limit: 100 } });

export const createServer = (base: string, payload: ServerCreate) =>
  request<Server>(base, '/servers', { method: 'POST', body: payload, timeoutMs: SPAWN_TIMEOUT_MS });

export const activateServer = (base: string, id: string) =>
  request<Server>(base, `/servers/${enc(id)}/activate`, { method: 'POST', timeoutMs: SPAWN_TIMEOUT_MS });

export const deactivateServer = (base: string, id: string) =>
  request<Server>(base, `/servers/${enc(id)}/deactivate`, { method: 'POST', timeoutMs: SPAWN_TIMEOUT_MS });

export const deleteServer = (base: string, id: string) =>
  request<null>(base, `/servers/${enc(id)}`, { method: 'DELETE', timeoutMs: SPAWN_TIMEOUT_MS });

// Servidor

export const getServer = (base: string, id: string) => request<Server>(base, `/servers/${enc(id)}`);

export const getServerBySlug = (base: string, slug: string) =>
  request<Server>(base, `/servers/by-slug/${enc(slug)}`);

export const serverAddress = (base: string, id: string) =>
  request<ServerAddress>(base, `/servers/${enc(id)}/address`);

// Identidad

export const join = (base: string, id: string, payload: JoinRequest) =>
  request<JoinResponse>(base, `/servers/${enc(id)}/join`, { method: 'POST', body: payload });

export const leave = (base: string, id: string, token: string) =>
  request<null>(base, `/servers/${enc(id)}/leave`, { method: 'POST', token });

export const me = (base: string, token: string) => request<MeResponse>(base, '/me', { token });

export const updateMe = (base: string, token: string, displayName: string) =>
  request<Member>(base, '/me', { method: 'PATCH', token, body: { display_name: displayName } });

export const members = (base: string, id: string) =>
  request<Page<Member>>(base, `/servers/${enc(id)}/members`, { query: { limit: 200 } });

export const setRole = (
  base: string,
  id: string,
  token: string,
  nickname: string,
  role: Exclude<Role, 'owner'>,
) =>
  request<Member>(base, `/servers/${enc(id)}/members/${enc(nickname)}/role`, {
    method: 'PUT',
    token,
    query: { role },
  });

export const kick = (base: string, id: string, token: string, nickname: string) =>
  request<null>(base, `/servers/${enc(id)}/members/${enc(nickname)}`, { method: 'DELETE', token });

// Llamadas

export const callParticipants = (base: string, serverId: string, channelId: string, token: string) =>
  request<CallParticipants>(base, `/servers/${enc(serverId)}/channels/${enc(channelId)}/call/participants`, {
    token,
    timeoutMs: 4000,
  });
