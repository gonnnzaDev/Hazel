// Cliente HTTP de la API de Recop (`/api/v1`).
//
// Hay dos tipos de proceso del otro lado, con la misma API:
//
// - el NODO del dueño (por defecto http://127.0.0.1:7272): crea, enciende,
//   apaga y borra servidores;
// - cada SERVIDOR (grupo) en su propio puerto: ahí se entra con un nickname,
//   se chatea y se habla por voz.
//
// Por eso cada función recibe la dirección base: no hay "un" servidor.

(function (R) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 10_000;
  // Encender un servidor es levantar un proceso: el nodo espera hasta 20 s.
  const SPAWN_TIMEOUT_MS = 30_000;

  class ApiError extends Error {
    constructor(message, { status = 0, code = 'error', data = null } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.data = data;
    }

    get isNetwork() {
      return this.status === 0;
    }
  }

  // En Electron la petición la hace el proceso principal (ver src/main.js);
  // en un navegador, `fetch` directo.
  async function transport({ url, method, headers, body, timeoutMs }) {
    if (window.recopBridge) {
      return window.recopBridge.request({ url, method, headers, body, timeoutMs });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal });
      return { ok: response.ok, status: response.status, body: await response.text() };
    } catch (error) {
      return { ok: false, status: 0, error: error.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  function hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  }

  // Convierte una respuesta `application/problem+json` en un mensaje para la
  // gente. El backend ya escribe `detail` en castellano; acá solo se cubren
  // los casos en que no lo hay.
  function errorFrom(status, data) {
    const code = (data && data.code) || `http_${status}`;

    if (code === 'request_validation_error' && Array.isArray(data.errors) && data.errors.length) {
      const first = data.errors[0];
      const message = String(first.msg || '').replace(/^Value error,\s*/i, '');
      return new ApiError(message || 'Revisá los datos e intentá de nuevo.', { status, code, data });
    }

    if (data && data.detail) return new ApiError(String(data.detail), { status, code, data });
    if (status === 401) return new ApiError('Tu sesión venció. Volvé a entrar.', { status, code, data });
    if (status === 404) return new ApiError('No se encontró lo que buscabas.', { status, code, data });
    return new ApiError(`El servidor respondió con un error (${status}).`, { status, code, data });
  }

  async function request(baseUrl, path, options = {}) {
    const { method = 'GET', body, token, query, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const url = new URL(`/api/v1${path}`, baseUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

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
      throw new ApiError(message, { status: 0, code: response.error || 'network' });
    }

    let data = null;
    if (response.body) {
      try {
        data = JSON.parse(response.body);
      } catch {
        data = null;
      }
    }

    if (!response.ok) throw errorFrom(response.status, data);
    return data;
  }

  // ─── Direcciones ────────────────────────────────────────────────────────────

  // Lo que la gente pega para unirse: "192.168.1.50:7273/casa-de-luis".
  // También acepta "http://…" y "recop://…", y el slug es opcional.
  function parseAddress(input) {
    let value = String(input || '').trim();
    if (!value) throw new ApiError('Escribí la dirección que te pasaron.');

    value = value.replace(/^(recop|https?):\/\//i, '');
    const [hostPort, ...rest] = value.split('/');
    const slug = rest.filter(Boolean)[0] || null;

    const match = hostPort.match(/^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/);
    if (!match) {
      throw new ApiError('La dirección tiene que tener la forma ip:puerto, por ejemplo 192.168.1.50:7273.');
    }

    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new ApiError('El puerto tiene que estar entre 1 y 65535.');

    return { baseUrl: `http://${match[1]}:${port}`, host: match[1], port, slug };
  }

  // La URL de un grupo que corre en la misma máquina que el nodo.
  function groupUrlFromNode(nodeUrl, port) {
    const url = new URL(nodeUrl);
    url.port = String(port);
    return url.origin;
  }

  function callSocketUrl(baseUrl, serverId, channelId, token) {
    const url = new URL(`/api/v1/servers/${serverId}/channels/${channelId}/call`, baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token);
    return url.toString();
  }

  // ─── Endpoints ──────────────────────────────────────────────────────────────

  const enc = encodeURIComponent;

  R.api = {
    ApiError,
    parseAddress,
    groupUrlFromNode,
    callSocketUrl,

    // Nodo
    nodeInfo: (base) => request(base, '/node', { timeoutMs: 4000 }),
    nodeAddress: (base) => request(base, '/node/address'),
    listServers: (base) => request(base, '/servers', { query: { limit: 100 } }),
    createServer: (base, payload) =>
      request(base, '/servers', { method: 'POST', body: payload, timeoutMs: SPAWN_TIMEOUT_MS }),
    activateServer: (base, id) =>
      request(base, `/servers/${enc(id)}/activate`, { method: 'POST', timeoutMs: SPAWN_TIMEOUT_MS }),
    deactivateServer: (base, id) =>
      request(base, `/servers/${enc(id)}/deactivate`, { method: 'POST', timeoutMs: SPAWN_TIMEOUT_MS }),
    deleteServer: (base, id) =>
      request(base, `/servers/${enc(id)}`, { method: 'DELETE', timeoutMs: SPAWN_TIMEOUT_MS }),

    // Servidor
    getServer: (base, id) => request(base, `/servers/${enc(id)}`),
    getServerBySlug: (base, slug) => request(base, `/servers/by-slug/${enc(slug)}`),

    // Identidad
    join: (base, id, payload) => request(base, `/servers/${enc(id)}/join`, { method: 'POST', body: payload }),
    leave: (base, id, token) => request(base, `/servers/${enc(id)}/leave`, { method: 'POST', token }),
    me: (base, token) => request(base, '/me', { token }),
    updateMe: (base, token, displayName) =>
      request(base, '/me', { method: 'PATCH', token, body: { display_name: displayName } }),
    members: (base, id) => request(base, `/servers/${enc(id)}/members`, { query: { limit: 200 } }),
    setRole: (base, id, token, nickname, role) =>
      request(base, `/servers/${enc(id)}/members/${enc(nickname)}/role`, {
        method: 'PUT',
        token,
        query: { role },
      }),
    kick: (base, id, token, nickname) =>
      request(base, `/servers/${enc(id)}/members/${enc(nickname)}`, { method: 'DELETE', token }),

    // Mensajes
    messages: (base, serverId, channelId, { limit = 50, offset = 0 } = {}) =>
      request(base, `/servers/${enc(serverId)}/channels/${enc(channelId)}/messages`, {
        query: { limit, offset },
      }),
    sendMessage: (base, serverId, channelId, token, content) =>
      request(base, `/servers/${enc(serverId)}/channels/${enc(channelId)}/messages`, {
        method: 'POST',
        token,
        body: { content },
      }),

    // Llamadas
    callParticipants: (base, serverId, channelId, token) =>
      request(base, `/servers/${enc(serverId)}/channels/${enc(channelId)}/call/participants`, {
        token,
        timeoutMs: 4000,
      }),
  };
})(window.Recop);
