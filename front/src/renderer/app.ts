// Punto de entrada de la ventana: acciones, sondeo periódico y arranque.
//
// El backend todavía no tiene WebSocket de chat, así que los mensajes, los
// miembros y quién está en cada canal de voz se piden cada pocos segundos.
// Cuando exista `WS /api/v1/ws`, el sondeo de mensajes se reemplaza por los
// eventos `message.created` sin tocar las vistas.

import * as api from './api';
import { ApiError, asApiError } from './api';
import { CallError, VoiceCall } from './call';
import { icon, type IconName } from './icons';
import {
  emptyNode,
  serverStateFor,
  state,
  type BusyKind,
  type ChatMessage,
  type ServerState,
  type Thread,
} from './state';
import * as store from './store';
import type { Channel, ChannelCreate, Member, Message, Role, Server, Theme } from './types';
import * as ui from './ui';
import { h, messageOf, normalizeNickname, normalizeSlug } from './util';
import * as views from './views';

const POLL_MS = 2500;
const MESSAGE_PAGE = 50;

const inFlight = new Set<string>();

// Evita pedir lo mismo dos veces a la vez cuando un servidor tarda.
async function once(key: string, fn: () => Promise<void>): Promise<void> {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await fn();
  } finally {
    inFlight.delete(key);
  }
}

function isOpen(key: string): boolean {
  return state.view === 'server' && state.sessionKey === key;
}

function nodeUrl(): string {
  return store.getSettings().nodeUrl;
}

// Lee un campo de texto de un formulario.
function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

// ─── Tema ─────────────────────────────────────────────────────────────────────

function isTheme(value: string): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function applyTheme(theme: Theme): void {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset['theme'] = theme;
  else delete document.documentElement.dataset['theme'];
}

// ─── Navegación ───────────────────────────────────────────────────────────────

function openHome(): void {
  state.view = 'home';
  state.sessionKey = null;
  store.updateSettings({ lastView: 'home' });
  views.renderAll();
  void refreshNode();
}

function openSession(key: string): void {
  const session = store.getSession(key);
  if (!session) return openHome();

  state.view = 'server';
  state.sessionKey = key;
  store.updateSettings({ lastView: key });

  const ss = serverStateFor(key);
  if (!ss.channelId && session.lastChannelId) ss.channelId = session.lastChannelId;
  pickChannel(ss);

  views.renderAll();
  void loadServer(key);
}

async function loadServer(key: string): Promise<void> {
  await refreshDetail(key);
  await Promise.all([refreshMembers(key), refreshMessages(key), refreshVoice(key), checkToken(key)]);
}

function selectChannel(channelId: string): void {
  const key = state.sessionKey;
  if (!key) return;
  const ss = serverStateFor(key);
  if (ss.channelId === channelId) return;
  ss.channelId = channelId;
  store.patchSession(key, { lastChannelId: channelId });
  views.renderServerSidebar();
  views.renderServerMain();
  void refreshMessages(key);
}

function toggleMembers(): void {
  state.showMembers = !state.showMembers;
  views.renderAll();
}

// ─── Nodo ─────────────────────────────────────────────────────────────────────

function nodeSignature(): string {
  const node = state.node;
  return JSON.stringify([
    node.status,
    node.info?.version,
    node.address?.recommended,
    node.servers.map((s) => [s.id, s.name, s.status, s.bind_port]),
    node.busy,
  ]);
}

async function refreshNode({ announce = false }: { announce?: boolean } = {}): Promise<void> {
  await once('node', async () => {
    const before = nodeSignature();
    const base = nodeUrl();
    try {
      const [info, list] = await Promise.all([api.nodeInfo(base), api.listServers(base)]);
      const address = state.node.address ?? (await api.nodeAddress(base).catch(() => null));
      state.node = { ...state.node, status: 'online', info, address, servers: list.items };
    } catch (error) {
      state.node = { ...state.node, status: 'offline', info: null, address: null, servers: [] };
      if (announce) ui.toast(messageOf(error), { kind: 'error' });
    }
    if (state.view === 'home' && nodeSignature() !== before) {
      views.renderHomeSidebar();
      views.renderHomeMain();
    }
  });
}

function bracket(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host.startsWith('127.') || host === '[::1]' || host === '::1';
}

// La dirección que el dueño le pasa a sus amigos: ip-de-la-red:puerto/slug.
// 127.0.0.1 no sirve para nadie más, así que se cambia por la IP que el
// nodo recomienda.
function shareableHost(host: string): string {
  const recommended = state.node.address?.recommended;
  return isLoopback(host) && recommended ? recommended : host;
}

function inviteAddressFor(server: Server): string {
  const host = shareableHost(new URL(nodeUrl()).hostname);
  return `${bracket(host)}:${server.bind_port}/${server.slug}`;
}

async function withBusy(server: Server, kind: BusyKind, fn: () => Promise<void>): Promise<void> {
  state.node.busy = { ...state.node.busy, [server.id]: kind };
  views.renderHomeMain();
  try {
    await fn();
  } catch (error) {
    ui.toast(messageOf(error), { kind: 'error' });
  } finally {
    const { [server.id]: _done, ...rest } = state.node.busy;
    state.node.busy = rest;
    await refreshNode();
    if (state.view === 'home') views.renderHomeMain();
  }
}

function startServer(server: Server): Promise<void> {
  return withBusy(server, 'start', async () => {
    const updated = await api.activateServer(nodeUrl(), server.id);
    if (updated.status === 'active') ui.toast(`${server.name} está encendido.`, { kind: 'success' });
    else ui.toast(`${server.name} no pudo arrancar. Mirá el log del nodo.`, { kind: 'error' });
  });
}

async function stopServer(server: Server): Promise<void> {
  const ok = await ui.confirmDialog({
    title: `¿Apagar ${server.name}?`,
    message:
      'La gente que esté conectada se va a desconectar. No se borra nada: cuando lo vuelvas a encender, está todo como estaba.',
    confirmLabel: 'Apagar',
  });
  if (!ok) return;
  await withBusy(server, 'stop', async () => {
    await api.deactivateServer(nodeUrl(), server.id);
    ui.toast(`${server.name} está apagado.`);
  });
}

async function deleteServer(server: Server): Promise<void> {
  const ok = await ui.confirmDialog({
    title: `¿Eliminar ${server.name}?`,
    message:
      'Se borran para siempre sus canales, miembros y mensajes. Esto no se puede deshacer. Si solo querés que nadie entre, apagalo.',
    confirmLabel: 'Eliminar para siempre',
    danger: true,
  });
  if (!ok) return;
  await withBusy(server, 'delete', async () => {
    await api.deleteServer(nodeUrl(), server.id);
    for (const session of store.listSessions().filter((s) => s.serverId === server.id)) {
      endCallIn(session);
      store.removeSession(session.key);
      delete state.servers[session.key];
    }
    views.renderRail();
    ui.toast(`${server.name} fue eliminado.`);
  });
}

// "Abrir" en el panel del nodo: si ya entraste, va directo; si no, entrás
// con un nickname. El primero que entra a un servidor es su dueño.
function openOwnedServer(server: Server): void {
  const existing = store.findSessionByServerId(server.id);
  if (existing) return openSession(existing.key);
  showJoinKnown({ baseUrl: api.groupUrlFromNode(nodeUrl(), server.bind_port), server });
}

// ─── Entrar a un servidor ─────────────────────────────────────────────────────

async function resolveServer(baseUrl: string, port: number, slug: string | null): Promise<Server> {
  if (slug) return api.getServerBySlug(baseUrl, slug);

  // Sin slug: el proceso del grupo conoce a los servidores del nodo, y el que
  // escucha en este puerto es el que buscamos.
  const list = await api.listServers(baseUrl);
  const byPort = list.items.find((s) => s.bind_port === port);
  if (byPort) return byPort;
  const active = list.items.filter((s) => s.status === 'active');
  if (active.length === 1 && active[0]) return active[0];
  throw new Error(
    'No encontramos el servidor en esa dirección. Pedí la dirección completa, con el nombre al final (ip:puerto/nombre).',
  );
}

interface Names {
  nickname: string;
  displayName?: string;
}

async function joinWith({
  baseUrl,
  server,
  nickname,
  displayName,
}: { baseUrl: string; server: Server } & Names) {
  if (server.status !== 'active') {
    throw new Error(`${server.name} está apagado. Pedile a su dueño que lo encienda.`);
  }

  const response = await api.join(baseUrl, server.id, { nickname, display_name: displayName });

  const key = store.sessionKey(baseUrl, server.id);
  const previous = store.getSession(key);
  store.saveSession({
    key,
    baseUrl,
    serverId: server.id,
    name: server.name,
    slug: server.slug,
    token: response.token,
    expiresAt: response.expires_at,
    member: response.member,
    lastChannelId: previous?.lastChannelId ?? null,
  });
  store.updateSettings({ lastNickname: response.member.nickname });

  const ss = serverStateFor(key);
  ss.sessionExpired = false;
  ss.gone = false;
  ss.detail = server;

  openSession(key);
  return response;
}

// Lo que la persona escribió en "Tu nickname". El backend lo normaliza
// ("Ana Paula" → @ana_paula); si cambia, lo escrito queda como nombre visible
// para que en el chat se vea "Ana Paula" y no "Ana_paula".
function namesFrom(raw: string): Names {
  const typed = raw.trim();
  const normalized = normalizeNickname(typed);
  return {
    nickname: typed,
    displayName: typed && normalized !== typed ? typed.slice(0, 64) : undefined,
  };
}

const NICKNAME_HINT = '2 a 32 caracteres: letras, números, punto, guion y guion bajo.';

function nicknameField(value: string): HTMLLabelElement {
  const preview = h('span', { class: 'field-hint' }, NICKNAME_HINT);
  const control = ui.input({
    name: 'nickname',
    required: true,
    maxlength: 32,
    value,
    placeholder: 'ej: ana',
  });
  const update = () => {
    const normalized = normalizeNickname(control.value);
    preview.textContent =
      control.value && normalized !== control.value
        ? `Vas a entrar como @${normalized || '…'}`
        : NICKNAME_HINT;
  };
  control.addEventListener('input', update);
  update();
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tu nickname'), control, preview);
}

function showJoin(): void {
  ui.formModal({
    title: 'Unirse a un servidor',
    subtitle: 'Sin cuenta ni contraseña: solo la dirección y un nombre.',
    submitLabel: 'Entrar',
    fields: [
      ui.field(
        'Dirección',
        ui.input({ name: 'address', required: true, placeholder: '192.168.1.50:7273/casa-de-luis' }),
        'Pedísela a quien armó el servidor.',
      ),
      nicknameField(store.getSettings().lastNickname),
    ],
    onSubmit: async (data, modal) => {
      const target = api.parseAddress(text(data, 'address'));
      const server = await resolveServer(target.baseUrl, target.port, target.slug);
      const response = await joinWith({
        baseUrl: target.baseUrl,
        server,
        ...namesFrom(text(data, 'nickname')),
      });
      modal.close();
      ui.toast(`Entraste a ${server.name} como @${response.member.nickname}.`, { kind: 'success' });
    },
  });
}

interface JoinKnownOptions {
  baseUrl: string;
  server: Server;
  title?: string;
  subtitle?: string;
  nickname?: string;
}

function showJoinKnown({ baseUrl, server, title, subtitle, nickname }: JoinKnownOptions): void {
  ui.formModal({
    title: title ?? `Entrar a ${server.name}`,
    subtitle: subtitle ?? 'Elegí con qué nombre te ven. Si sos el primero en entrar, quedás como dueño.',
    submitLabel: 'Entrar',
    fields: [nicknameField(nickname ?? store.getSettings().lastNickname)],
    onSubmit: async (data, modal) => {
      await joinWith({ baseUrl, server, ...namesFrom(text(data, 'nickname')) });
      modal.close();
    },
  });
}

async function showRejoin(): Promise<void> {
  const session = views.currentSession();
  if (!session) return;
  const ss = serverStateFor(session.key);
  let server = ss.detail;
  if (!server) {
    try {
      server = await api.getServer(session.baseUrl, session.serverId);
    } catch (error) {
      ui.toast(messageOf(error), { kind: 'error' });
      return;
    }
  }
  showJoinKnown({
    baseUrl: session.baseUrl,
    server,
    title: 'Volver a entrar',
    subtitle: 'Entrando con el mismo nickname recuperás tu lugar: no hace falta contraseña.',
    nickname: session.member.nickname,
  });
}

function showAddServer(): void {
  const option = (iconName: IconName, title: string, description: string, onClick: () => void) =>
    h(
      'button',
      { class: 'choice', onclick: onClick },
      h('span', { class: 'choice-icon' }, icon(iconName, 22)),
      h('span', { class: 'choice-text' }, h('strong', null, title), h('small', null, description)),
    );

  ui.modal({
    title: 'Agregar un servidor',
    subtitle: 'Armá el tuyo o entrá al de alguien más.',
    body: h(
      'div',
      { class: 'choices' },
      option('server', 'Crear mi servidor', 'Corre en tu compu. Vos decidís cuándo está encendido.', () => {
        ui.closeModal();
        showCreateServer();
      }),
      option('logIn', 'Unirme a un servidor', 'Con la dirección que te pasaron.', () => {
        ui.closeModal();
        showJoin();
      }),
    ),
  });
}

// ─── Crear un servidor ────────────────────────────────────────────────────────

function showCreateServer(): void {
  if (state.node.status !== 'online') {
    openHome();
    ui.toast('Para crear un servidor tiene que estar encendido tu nodo.', { kind: 'error' });
    return;
  }

  const name = ui.input({ name: 'name', required: true, maxlength: 64, placeholder: 'Casa de Luis' });
  const slug = ui.input({ name: 'slug', maxlength: 64, placeholder: 'casa-de-luis' });
  let slugTouched = false;
  name.addEventListener('input', () => {
    if (!slugTouched) slug.value = normalizeSlug(name.value);
  });
  slug.addEventListener('input', () => {
    slugTouched = true;
  });

  const voice = h('input', { type: 'checkbox', name: 'voice', checked: true });

  ui.formModal({
    title: 'Crear un servidor',
    subtitle: 'Va a correr en esta compu y le vas a pasar la dirección a tus amigos.',
    submitLabel: 'Crear servidor',
    fields: [
      ui.field('Nombre', name),
      ui.field(
        'Identificador',
        slug,
        'Va al final de la dirección que compartís. Solo letras, números y guiones.',
      ),
      nicknameField(store.getSettings().lastNickname),
      h('label', { class: 'check' }, voice, h('span', null, 'Agregar un canal de voz')),
    ],
    onSubmit: async (data, modal) => {
      const serverName = text(data, 'name').trim();
      const serverSlug = normalizeSlug(text(data, 'slug') || serverName);
      const names = namesFrom(text(data, 'nickname'));
      if (serverName.length < 2) throw new Error('El nombre tiene que tener al menos 2 caracteres.');
      if (serverSlug.length < 2)
        throw new Error('El identificador tiene que tener al menos 2 letras o números.');

      const channels: ChannelCreate[] = [{ name: 'general', kind: 'text', is_default: true, position: 0 }];
      if (data.get('voice')) channels.push({ name: 'charla', kind: 'voice', position: 1 });

      const server = await api.createServer(nodeUrl(), {
        name: serverName,
        slug: serverSlug,
        owner_nickname: names.nickname,
        channels,
      });
      modal.close();
      await refreshNode();

      if (server.status !== 'active') {
        ui.toast(`${server.name} se creó, pero no arrancó. Probá encenderlo desde Mis servidores.`, {
          kind: 'error',
          timeout: 6000,
        });
        return;
      }

      try {
        await joinWith({ baseUrl: api.groupUrlFromNode(nodeUrl(), server.bind_port), server, ...names });
        ui.toast(`${server.name} está listo. Invitá a tus amigos con su dirección.`, { kind: 'success' });
      } catch (error) {
        ui.toast(`${server.name} se creó, pero no pudimos entrar: ${messageOf(error)}`, {
          kind: 'error',
          timeout: 6000,
        });
      }
    },
  });
}

// ─── Datos del servidor abierto ───────────────────────────────────────────────

// Un error de red marca el servidor como inalcanzable; un 401, la sesión como
// vencida; un 404 del servidor, que lo borraron. Cualquier otra cosa se avisa.
function noteFailure(key: string, error: unknown, { quiet = true }: { quiet?: boolean } = {}): void {
  const ss = serverStateFor(key);
  const failure = asApiError(error);
  if (failure.isNetwork) {
    if (ss.reachable) {
      ss.reachable = false;
      repaintStatus(key);
    }
  } else if (failure.status === 401) {
    if (!ss.sessionExpired) {
      ss.sessionExpired = true;
      repaintStatus(key);
    }
  } else if (failure.code === 'server_not_found') {
    if (!ss.gone) {
      ss.gone = true;
      repaintStatus(key);
    }
  } else if (!quiet) {
    ui.toast(failure.message, { kind: 'error' });
  }
}

function noteSuccess(key: string): void {
  const ss = serverStateFor(key);
  if (!ss.reachable) {
    ss.reachable = true;
    repaintStatus(key);
  }
}

function repaintStatus(key: string): void {
  views.renderRail();
  if (isOpen(key)) views.renderBanner();
}

// Si el canal abierto ya no existe (o todavía no hay uno), cae en el canal
// por defecto del servidor. Devuelve si cambió.
function pickChannel(ss: ServerState): boolean {
  if (!ss.detail) return false;
  const textChannels = ss.detail.channels.filter((c) => c.kind === 'text');
  if (textChannels.some((c) => c.id === ss.channelId)) return false;
  const fallback = textChannels.find((c) => c.is_default) ?? textChannels[0];
  ss.channelId = fallback ? fallback.id : null;
  return true;
}

async function refreshDetail(key: string): Promise<void> {
  const session = store.getSession(key);
  if (!session) return;
  await once(`detail:${key}`, async () => {
    const ss = serverStateFor(key);
    try {
      const detail = await api.getServer(session.baseUrl, session.serverId);
      const before = JSON.stringify(ss.detail);
      ss.detail = detail;
      noteSuccess(key);

      if (detail.name !== session.name) store.patchSession(key, { name: detail.name });

      const channelChanged = pickChannel(ss);

      if (isOpen(key) && (channelChanged || JSON.stringify(detail) !== before)) {
        views.renderRail();
        views.renderServerSidebar();
        views.renderServerMain();
      }
    } catch (error) {
      noteFailure(key, error);
      if (isOpen(key) && !ss.detail) views.renderAll();
    }
  });
}

async function checkToken(key: string): Promise<void> {
  const session = store.getSession(key);
  if (!session) return;
  try {
    const me = await api.me(session.baseUrl, session.token);
    store.patchSession(key, { member: me.member });
  } catch (error) {
    noteFailure(key, error);
  }
}

async function refreshMembers(key: string): Promise<void> {
  const session = store.getSession(key);
  if (!session) return;
  await once(`members:${key}`, async () => {
    const ss = serverStateFor(key);
    try {
      const data = await api.members(session.baseUrl, session.serverId);
      const before = JSON.stringify(ss.members);
      ss.members = data.items;
      noteSuccess(key);

      const me = data.items.find((m) => m.nickname === session.member.nickname);
      if (me && JSON.stringify(me) !== JSON.stringify(session.member))
        store.patchSession(key, { member: me });

      if (isOpen(key) && JSON.stringify(ss.members) !== before) {
        views.renderMembers();
        views.renderMessages(); // los nombres visibles salen de acá
      }
    } catch (error) {
      noteFailure(key, error);
    }
  });
}

function threadFor(ss: ServerState, channelId: string): Thread {
  let thread = ss.messages[channelId];
  if (!thread) {
    thread = { items: [], total: 0, loaded: false, loadingOlder: false };
    ss.messages[channelId] = thread;
  }
  return thread;
}

function byDate(a: Message, b: Message): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

// Junta lo que ya había con lo que llegó, sin duplicados y en orden. Los
// mensajes que todavía se están enviando quedan al final.
function merge(thread: Thread, incoming: Message[]): void {
  const byId = new Map<string, ChatMessage>(thread.items.filter((m) => !m.pending).map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  const pending = thread.items.filter((m) => m.pending);
  thread.items = [...[...byId.values()].sort(byDate), ...pending];
}

function threadSignature(thread: Thread): string {
  const last = thread.items[thread.items.length - 1];
  return `${thread.loaded}|${thread.total}|${thread.items.length}|${last ? last.id : ''}`;
}

async function refreshMessages(key: string): Promise<void> {
  const session = store.getSession(key);
  const ss = serverStateFor(key);
  const channelId = ss.channelId;
  if (!session || !channelId) return;

  await once(`messages:${key}:${channelId}`, async () => {
    const thread = threadFor(ss, channelId);
    const before = threadSignature(thread);
    try {
      const data = await api.messages(session.baseUrl, session.serverId, channelId, { limit: MESSAGE_PAGE });
      merge(thread, data.items);
      thread.total = data.total;
      thread.loaded = true;
      noteSuccess(key);
    } catch (error) {
      noteFailure(key, error);
      return;
    }
    // Alguien nuevo escribió: se piden los miembros ya, para mostrar su
    // nombre visible en vez del nickname. Una sola vez por cada desconocido:
    // quien se fue del servidor no va a aparecer nunca en la lista.
    const known = new Set(ss.members.map((m) => m.nickname));
    const unknown = [
      ...new Set(
        thread.items.filter((m) => !m.pending && !known.has(m.author_nickname)).map((m) => m.author_nickname),
      ),
    ]
      .sort()
      .join(',');
    if (unknown && unknown !== ss.unknownAuthors) {
      ss.unknownAuthors = unknown;
      void refreshMembers(key);
    }
    if (isOpen(key) && ss.channelId === channelId && threadSignature(thread) !== before) {
      views.renderMessages();
    }
  });
}

async function loadOlder(): Promise<void> {
  const key = state.sessionKey;
  const session = key ? store.getSession(key) : null;
  if (!key || !session) return;
  const ss = serverStateFor(key);
  const channelId = ss.channelId;
  if (!channelId) return;
  const thread = threadFor(ss, channelId);
  if (thread.loadingOlder) return;

  thread.loadingOlder = true;
  views.renderMessages();
  const scroller = document.getElementById('messages');
  const fromBottom = scroller ? scroller.scrollHeight - scroller.scrollTop : null;
  try {
    const offset = thread.items.filter((m) => !m.pending).length;
    const data = await api.messages(session.baseUrl, session.serverId, channelId, {
      limit: MESSAGE_PAGE,
      offset,
    });
    merge(thread, data.items);
    thread.total = data.total;
  } catch (error) {
    ui.toast(messageOf(error), { kind: 'error' });
  } finally {
    thread.loadingOlder = false;
    if (isOpen(key) && ss.channelId === channelId) views.renderMessages({ keepOffsetFrom: fromBottom });
  }
}

async function sendMessage(content: string): Promise<void> {
  const key = state.sessionKey;
  const session = key ? store.getSession(key) : null;
  if (!key || !session) return;
  const ss = serverStateFor(key);
  const channelId = ss.channelId;
  if (!channelId) return;

  const thread = threadFor(ss, channelId);
  const pending: ChatMessage = {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    author_nickname: session.member.nickname,
    content,
    created_at: new Date().toISOString(),
    pending: true,
  };
  thread.items.push(pending);
  views.renderMessages({ forceBottom: true });

  try {
    const message = await api.sendMessage(
      session.baseUrl,
      session.serverId,
      channelId,
      session.token,
      content,
    );
    thread.items = thread.items.filter((m) => m !== pending);
    merge(thread, [message]);
    thread.total += 1;
    noteSuccess(key);
  } catch (error) {
    thread.items = thread.items.filter((m) => m !== pending);
    noteFailure(key, error, { quiet: false });
    const failure = asApiError(error);
    if (failure.isNetwork) ui.toast('No se pudo enviar: el servidor no responde.', { kind: 'error' });
    if (failure.status === 401) ui.toast('No se pudo enviar: tu sesión venció.', { kind: 'error' });
    restoreDraft(content);
  }
  if (isOpen(key) && ss.channelId === channelId) views.renderMessages({ forceBottom: true });
}

// Si un mensaje no salió, vuelve al campo de texto para no perderlo.
function restoreDraft(content: string): void {
  const composer = document.getElementById('composer');
  if (composer instanceof HTMLTextAreaElement && !composer.value) {
    composer.value = content;
    composer.dispatchEvent(new Event('input'));
  }
}

// ─── Voz ──────────────────────────────────────────────────────────────────────

async function refreshVoice(key: string): Promise<void> {
  const session = store.getSession(key);
  const ss = serverStateFor(key);
  if (!session || !ss.detail || ss.sessionExpired) return;
  const voiceChannels = ss.detail.channels.filter((c) => c.kind === 'voice');
  if (!voiceChannels.length) return;

  await once(`voice:${key}`, async () => {
    const before = JSON.stringify(ss.voice);
    try {
      const results = await Promise.all(
        voiceChannels.map((c) =>
          api.callParticipants(session.baseUrl, session.serverId, c.id, session.token),
        ),
      );
      ss.voice = Object.fromEntries(results.map((r) => [r.channel_id, r.participants]));
    } catch (error) {
      noteFailure(key, error);
      return;
    }
    if (isOpen(key) && JSON.stringify(ss.voice) !== before) views.renderServerSidebar();
  });
}

function repaintCall(): void {
  if (state.view === 'server') views.renderServerSidebar();
  else views.renderHomeSidebar();
  views.renderRail();
}

// El indicador de quién habla cambia varias veces por segundo: se actualiza
// en el lugar para no redibujar la lista bajo el mouse.
function paintSpeaking(call: VoiceCall): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-speaker]')) {
    el.classList.toggle('is-speaking', call.isSpeaking(el.dataset['speaker']));
  }
}

async function joinVoice(channel: Channel): Promise<void> {
  const session = views.currentSession();
  if (!session) return;

  if (state.call) {
    state.call.end(null, { silent: true });
    state.call = null;
  }

  const call = new VoiceCall({
    baseUrl: session.baseUrl,
    serverId: session.serverId,
    channelId: channel.id,
    channelName: channel.name,
    serverName: session.name,
    token: session.token,
    self: session.member,
    onChange: (c, kind) => {
      if (state.call !== c) return;
      if (kind === 'speaking') paintSpeaking(c);
      else repaintCall();
    },
    onEnd: (c, reason) => {
      if (state.call === c) state.call = null;
      if (reason) ui.toast(reason, { kind: 'error' });
      repaintCall();
      void refreshVoice(session.key);
    },
  });

  state.call = call;
  repaintCall();
  try {
    await call.start();
  } catch (error) {
    if (state.call === call) state.call = null;
    if (error instanceof CallError && (error.code === 'invalid_token' || error.code === 'missing_token')) {
      noteFailure(session.key, new ApiError(error.message, { status: 401 }));
    }
    ui.toast(messageOf(error), { kind: 'error' });
  }
  repaintCall();
}

function leaveCall(): void {
  const call = state.call;
  if (!call) return;
  state.call = null;
  call.end(null, { silent: true });
  repaintCall();
  if (state.sessionKey) void refreshVoice(state.sessionKey);
}

function endCallIn(session: { baseUrl: string; serverId: string }): void {
  const call = state.call;
  if (call && call.baseUrl === session.baseUrl && call.serverId === session.serverId) leaveCall();
}

// ─── Miembros ─────────────────────────────────────────────────────────────────

async function setRole(member: Member, role: Exclude<Role, 'owner'>): Promise<void> {
  const session = views.currentSession();
  if (!session) return;
  try {
    await api.setRole(session.baseUrl, session.serverId, session.token, member.nickname, role);
    ui.toast(
      role === 'admin'
        ? `${member.display_name} ahora es administrador.`
        : `${member.display_name} ya no es administrador.`,
      { kind: 'success' },
    );
    await refreshMembers(session.key);
  } catch (error) {
    noteFailure(session.key, error, { quiet: false });
  }
}

async function kick(member: Member): Promise<void> {
  const session = views.currentSession();
  if (!session) return;
  const ok = await ui.confirmDialog({
    title: `¿Expulsar a ${member.display_name}?`,
    message: `@${member.nickname} sale del servidor. Puede volver a entrar si tiene la dirección.`,
    confirmLabel: 'Expulsar',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.kick(session.baseUrl, session.serverId, session.token, member.nickname);
    ui.toast(`${member.display_name} fue expulsado.`);
    await refreshMembers(session.key);
  } catch (error) {
    noteFailure(session.key, error, { quiet: false });
  }
}

function showEditDisplayName(): void {
  const session = views.currentSession();
  if (!session) return;
  ui.formModal({
    title: 'Tu nombre visible',
    subtitle: `Es como te ven en ${session.name}. Tu nickname (@${session.member.nickname}) no cambia.`,
    submitLabel: 'Guardar',
    fields: [
      ui.field(
        'Nombre visible',
        ui.input({ name: 'display_name', required: true, maxlength: 64, value: session.member.display_name }),
      ),
    ],
    onSubmit: async (data, modal) => {
      const member = await api.updateMe(session.baseUrl, session.token, text(data, 'display_name').trim());
      store.patchSession(session.key, { member });
      modal.close();
      ui.toast('Listo, cambiaste tu nombre.', { kind: 'success' });
      await refreshMembers(session.key);
      views.renderServerSidebar();
    },
  });
}

// ─── Invitar y salir ──────────────────────────────────────────────────────────

function showInvite(): void {
  const session = views.currentSession();
  if (!session) return;
  const url = new URL(session.baseUrl);
  const host = shareableHost(url.hostname);
  const address = `${bracket(host)}:${url.port}/${session.slug}`;
  const onlyHere = isLoopback(host);

  const box = ui.input({ value: address, readonly: true, 'aria-label': 'Dirección del servidor' });
  box.addEventListener('focus', () => box.select());

  ui.modal({
    title: `Invitar gente a ${session.name}`,
    subtitle: 'Pasales esta dirección. Entran con un nickname, sin cuenta.',
    body: h(
      'div',
      { class: 'form' },
      h(
        'div',
        { class: 'copy-row' },
        box,
        h(
          'button',
          { class: 'btn btn-primary', onclick: () => void ui.copy(address, 'Dirección copiada.') },
          icon('copy', 16),
          'Copiar',
        ),
      ),
      h(
        'p',
        { class: 'field-hint' },
        onlyHere
          ? '127.0.0.1 solo sirve en esta compu. Para tus amigos, cambialo por la IP de tu compu en la red (la ves con ipconfig o ip addr).'
          : 'Tienen que estar en tu misma red, o poder llegar a ese puerto de tu compu.',
      ),
    ),
  });
}

async function leaveServer(): Promise<void> {
  const session = views.currentSession();
  if (!session) return;
  const ok = await ui.confirmDialog({
    title: `¿Salir de ${session.name}?`,
    message:
      'Dejás de ser miembro. Si eras el dueño, el rol pasa al miembro más antiguo. Podés volver a entrar con la dirección.',
    confirmLabel: 'Salir del servidor',
    danger: true,
  });
  if (!ok) return;

  try {
    await api.leave(session.baseUrl, session.serverId, session.token);
  } catch (error) {
    const failure = asApiError(error);
    if (failure.status !== 401 && failure.code !== 'server_not_found') {
      const forget = await ui.confirmDialog({
        title: 'No pudimos avisarle al servidor',
        message: `${failure.message} ¿Lo quitamos de tu lista igual?`,
        confirmLabel: 'Quitar de mi lista',
        danger: true,
      });
      if (!forget) return;
    }
  }
  forgetSession(session.key);
}

function forgetSession(key: string): void {
  const session = store.getSession(key);
  if (session) endCallIn(session);
  store.removeSession(key);
  delete state.servers[key];
  openHome();
}

// ─── Configuración ────────────────────────────────────────────────────────────

const THEMES: [Theme, string][] = [
  ['system', 'Como el sistema'],
  ['light', 'Claro'],
  ['dark', 'Oscuro'],
];

function showSettings(): void {
  const settings = store.getSettings();
  const themeGroup = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Tema' },
    THEMES.map(([value, label]) =>
      h(
        'label',
        { class: 'segmented-option' },
        h('input', { type: 'radio', name: 'theme', value, checked: settings.theme === value }),
        h('span', null, label),
      ),
    ),
  );
  themeGroup.addEventListener('change', (event) => {
    const value = (event.target as HTMLInputElement).value;
    if (isTheme(value)) applyTheme(value);
  });

  ui.formModal({
    title: 'Configuración',
    submitLabel: 'Guardar',
    fields: [
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tema'), themeGroup),
      ui.field(
        'Dirección de tu nodo',
        ui.input({
          name: 'nodeUrl',
          required: true,
          value: settings.nodeUrl,
          placeholder: 'http://127.0.0.1:7272',
        }),
        'Donde corre tu nodo. Si lo arrancaste en esta compu, dejalo como está.',
      ),
    ],
    // Cerrar sin guardar devuelve el tema que había; guardando, ya es el nuevo.
    onClose: () => applyTheme(store.getSettings().theme),
    onSubmit: async (data, modal) => {
      let url = text(data, 'nodeUrl').trim();
      if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('Esa dirección no es válida. Ejemplo: http://127.0.0.1:7272');
      }
      const chosen = text(data, 'theme');
      const theme = isTheme(chosen) ? chosen : settings.theme;
      const nodeChanged = parsed.origin !== new URL(settings.nodeUrl).origin;
      store.updateSettings({ theme, nodeUrl: parsed.origin });
      applyTheme(theme);
      modal.close();
      if (nodeChanged) {
        state.node = emptyNode();
        views.renderAll();
        await refreshNode({ announce: true });
      }
    },
  });
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

let tick = 0;

function poll(): void {
  if (document.hidden) return;
  tick += 1;
  if (state.view === 'home') {
    if (tick % 2 === 0) void refreshNode();
    return;
  }
  const key = state.sessionKey;
  if (!key) return;
  void refreshMessages(key);
  if (tick % 2 === 0) void refreshVoice(key);
  if (tick % 4 === 0) void refreshMembers(key);
  if (tick % 8 === 0) void refreshDetail(key);
  if (tick % 12 === 0) void refreshNode();
}

function boot(): void {
  views.bindActions({
    openHome,
    openSession,
    selectChannel,
    toggleMembers,
    refreshNode,
    inviteAddressFor,
    startServer,
    stopServer,
    deleteServer,
    openOwnedServer,
    showJoin,
    showRejoin,
    showAddServer,
    showCreateServer,
    sendMessage,
    loadOlder,
    joinVoice,
    leaveCall,
    setRole,
    kick,
    showEditDisplayName,
    showInvite,
    leaveServer,
    forgetSession,
    showSettings,
  });

  // Para mirar el estado desde las herramientas de desarrollo (`npm run dev`).
  window.Recop = { state, store };

  const settings = store.getSettings();
  applyTheme(settings.theme);

  if (settings.lastView && settings.lastView !== 'home' && store.getSession(settings.lastView)) {
    openSession(settings.lastView);
  } else {
    state.view = 'home';
    views.renderAll();
  }
  void refreshNode();

  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tick = 0;
      poll();
      if (state.view === 'server' && state.sessionKey) void loadServer(state.sessionKey);
    }
  });
  window.addEventListener('beforeunload', () => {
    state.call?.end(null, { silent: true });
  });
}

boot();
