// Todo lo que la app hace, en un solo lugar: arrancar, hablar con el nodo,
// entrar y salir de servidores, mandar mensajes, la voz y los avisos.
//
// Los componentes leen los stores y llaman a estas funciones; no hablan con la
// red directamente.

import * as api from './lib/api';
import { asApiError } from './lib/api';
import { slashCommands } from './lib/commands';
import { mentionsIn, plainText } from './lib/markdown';
import type { CallParticipant, ChatMessage, Member, Presence, Server } from './lib/types';
import { allBuses, busHooks, getBus, startBus, stopBus } from './net/bus';
import { VoiceError, VoiceSession } from './net/voice';
import {
  bootLine,
  closeModal,
  openModal,
  pushHistory,
  settleBootLine,
  toast,
  useApp,
  type View,
} from './store/app';
import { addNotice, clearChannel, dmChannel, findMessage, forget, hydrate, isDm, markRead, useChat } from './store/chat';
import { getSession, sessionKey, useSessions } from './store/sessions';
import { useSettings } from './store/settings';
import { useVoice } from './store/voice';

export const VERSION = '0.2.0';

const nodeUrl = () => useSettings.getState().nodeUrl;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function errorText(error: unknown): string {
  return asApiError(error).message;
}

/** La sesión de lo que se está mirando, si es un servidor. */
export function currentKey(view: View = useApp.getState().view): string | null {
  return view.kind === 'home' ? null : view.key;
}

/** "Casa de Luis" → "casa-de-luis". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length >= 2 ? slug : `servidor-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

let loopsStarted = false;

export async function boot(): Promise<void> {
  const versions = window.hazelBridge?.versions;
  bootLine(
    'INFO',
    `hazel-desktop ${VERSION} · electron ${versions?.electron ?? '—'} · chromium ${(versions?.chrome ?? '—').split('.')[0]}`,
  );

  const node = hostOf(nodeUrl());
  const nodeLine = bootLine('WAIT', `Conectando con tu nodo en ${node}…`);
  if (await refreshNode()) {
    const { info, servers } = useApp.getState().node;
    settleBootLine(nodeLine, ' OK ', `Nodo ${node} en línea · Hazel ${info?.version ?? ''}`);
    bootLine(' OK ', `${servers.length} ${servers.length === 1 ? 'servidor' : 'servidores'} en este nodo`);
  } else {
    settleBootLine(nodeLine, 'WARN', `Tu nodo en ${node} no responde (levantalo con: uv run python -m core node)`);
  }

  const sessions = useSessions.getState().sessions;
  if (sessions.length) {
    const line = bootLine('WAIT', `Restaurando ${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}…`);
    await Promise.all(sessions.map((s) => refreshSession(s.key)));
    const { unreachable } = useApp.getState();
    const now = useSessions.getState().sessions;
    const bad = now.filter((s) => s.expired || unreachable[s.key]).length;
    settleBootLine(line, bad ? 'WARN' : ' OK ', `${now.length - bad} de ${now.length} sesiones listas`);
    bootLine(' OK ', `Chat P2P: ${allBuses().length} ${allBuses().length === 1 ? 'sala' : 'salas'} abiertas`);
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput').length;
    if (mics) bootLine(' OK ', `Audio: ${mics} ${mics === 1 ? 'micrófono' : 'micrófonos'}`);
    else bootLine('WARN', 'Audio: no hay micrófono (la voz no va a andar)');
  } catch {
    bootLine('WARN', 'Audio: no se pudo revisar el micrófono');
  }

  restoreView();
  startLoops();
  bootLine('INFO', 'Listo.');
  useApp.setState((s) => ({ boot: { ...s.boot, done: true } }));
}

function restoreView(): void {
  const last = useSettings.getState().lastView;
  const [key, channelId] = last.split('#');
  const session = getSession(key);
  const server = key ? useApp.getState().servers[key] : undefined;
  if (session && server && channelId && server.channels.some((c) => c.id === channelId && c.kind === 'text')) {
    selectChannel(session.key, channelId);
  }
}

function startLoops(): void {
  if (loopsStarted) return;
  loopsStarted = true;
  setInterval(() => void measure(), 2000);
  setInterval(() => void refreshVoiceRooms(), 5000);
  setInterval(() => void refreshNode(), 15_000);
  setInterval(() => {
    const key = currentKey();
    if (key) void refreshSession(key);
  }, 20_000);
  void measure();
}

/** Latencia al nodo de lo que estás mirando y uso de la máquina. */
async function measure(): Promise<void> {
  const session = getSession(currentKey());
  const target = session?.baseUrl ?? nodeUrl();
  let ms: number | null = null;
  try {
    ms = await api.ping(target);
  } catch {
    ms = null;
  }
  useApp.setState((s) => ({
    latency: {
      target,
      ms,
      history: s.latency.target === target ? pushHistory(s.latency.history, ms ?? 0) : [ms ?? 0],
    },
  }));

  if (window.hazelBridge) {
    try {
      const stats = await window.hazelBridge.stats();
      useApp.setState((s) => ({
        system: {
          cpu: pushHistory(s.system.cpu, stats.cpu),
          cores: stats.cores,
          memUsed: stats.memUsed,
          memTotal: stats.memTotal,
          available: true,
        },
      }));
    } catch {
      // sin widget de CPU
    }
  }
}

// ─── Nodo propio ──────────────────────────────────────────────────────────────

export async function refreshNode(): Promise<boolean> {
  const base = nodeUrl();
  try {
    const [info, servers, address] = await Promise.all([
      api.nodeInfo(base),
      api.listServers(base),
      api.nodeAddress(base).catch(() => null),
    ]);
    useApp.setState({
      node: {
        status: 'online',
        info,
        address,
        servers: servers.items.filter((s) => s.status !== 'deleted'),
        error: null,
      },
    });
    return true;
  } catch (error) {
    useApp.setState((s) => ({ node: { ...s.node, status: 'offline', error: errorText(error) } }));
    return false;
  }
}

export async function changeNodeUrl(input: string): Promise<boolean> {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    url = new URL(url).origin;
  } catch {
    toast('Esa dirección no es válida.', 'error');
    return false;
  }
  useSettings.getState().set({ nodeUrl: url });
  // Lo que se sabía era del nodo anterior.
  useApp.setState({ node: { status: 'connecting', info: null, address: null, servers: [], error: null } });
  const ok = await refreshNode();
  toast(ok ? `Conectado al nodo ${hostOf(url)}` : `No responde ningún nodo en ${hostOf(url)}`, ok ? 'success' : 'error');
  return ok;
}

export async function createServer(input: { name: string; nickname: string; description: string }): Promise<void> {
  const base = nodeUrl();
  const server = await api.createServer(base, {
    name: input.name.trim(),
    slug: slugify(input.name),
    owner_nickname: input.nickname.trim(),
    description: input.description.trim() || undefined,
    channels: [
      { name: 'general', kind: 'text', position: 0, is_default: true },
      { name: 'Charla', kind: 'voice', position: 1 },
    ],
  });
  await refreshNode();
  toast(`${server.name} está en línea`, 'success');
  await enterServer(base, server.id, input.nickname);
}

export async function toggleServer(server: Server): Promise<void> {
  const base = nodeUrl();
  const turningOff = server.status === 'active';
  try {
    if (turningOff) await api.deactivateServer(base, server.id);
    else await api.activateServer(base, server.id);
  } catch (error) {
    toast(errorText(error), 'error');
    return;
  }
  await refreshNode();
  const key = sessionKey(base, server.id);
  if (getSession(key)) await refreshSession(key);
  toast(turningOff ? `${server.name} está apagado` : `${server.name} está encendido`, turningOff ? 'info' : 'success');
}

export function confirmDeleteServer(server: Server): void {
  openModal({
    kind: 'confirm',
    title: `Borrar ${server.name}`,
    text: 'Se borran sus canales y sus miembros. No se puede deshacer. Los mensajes que cada uno guardó en su app quedan ahí.',
    action: 'Borrar para siempre',
    danger: true,
    onConfirm: async () => {
      await api.deleteServer(nodeUrl(), server.id);
      const key = sessionKey(nodeUrl(), server.id);
      dropSession(key);
      await refreshNode();
      toast(`${server.name} se borró`);
    },
  });
}

/** La dirección para pasarle a otra persona: `ip:puerto/slug`. */
export async function shareAddress(baseUrl: string, server: Pick<Server, 'id' | 'slug'>): Promise<string> {
  if (baseUrl === nodeUrl()) {
    try {
      const address = await api.serverAddress(baseUrl, server.id);
      const host = address.node.recommended ?? (address.node.is_wildcard ? '127.0.0.1' : address.node.bind_host);
      const shown = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      return `${shown}:${address.node.port}/${address.slug}`;
    } catch {
      // si no, la dirección que usa esta app
    }
  }
  return `${hostOf(baseUrl)}/${server.slug}`;
}

export async function copyAddress(baseUrl: string, server: Pick<Server, 'id' | 'slug' | 'name'>): Promise<void> {
  const address = await shareAddress(baseUrl, server);
  await copy(address);
  toast(`Dirección de ${server.name} copiada: ${address}`, 'success');
}

export async function copy(text: string): Promise<void> {
  if (window.hazelBridge) await window.hazelBridge.copy(text);
  else await navigator.clipboard.writeText(text);
}

// ─── Sesiones (entrar a un servidor) ──────────────────────────────────────────

/** Abre uno de tus servidores: entra directo si ya tenés sesión, si no pide el nickname. */
export function openOwnServer(server: Server): void {
  const key = sessionKey(nodeUrl(), server.id);
  const session = getSession(key);
  if (session && !session.expired) selectSession(key);
  else openModal({ kind: 'enter', serverId: server.id, serverName: server.name, baseUrl: nodeUrl() });
}

export async function enterServer(baseUrl: string, serverId: string, nickname: string, displayName?: string): Promise<void> {
  const joined = await api.join(baseUrl, serverId, {
    nickname: nickname.trim(),
    display_name: displayName?.trim() || undefined,
  });
  const key = sessionKey(baseUrl, serverId);
  const previous = getSession(key);
  useSessions.getState().upsert({
    key,
    baseUrl,
    serverId,
    name: joined.server.name,
    slug: joined.server.slug,
    token: joined.token,
    expiresAt: joined.expires_at,
    member: joined.member,
    lastChannelId: previous?.lastChannelId ?? null,
    expired: false,
  });
  useSettings.getState().set({ lastNickname: joined.member.nickname });
  if (previous) stopBus(key); // el token cambió: la sala se abre de nuevo
  await refreshSession(key);
  selectSession(key);
}

/** Entrar al servidor de otra persona con la dirección que te pasó. */
export async function joinByAddress(address: string, nickname: string, displayName?: string): Promise<void> {
  const parsed = api.parseAddress(address);
  if (!parsed.slug) throw new api.ApiError('Falta el nombre del servidor después de la barra, por ejemplo 192.168.1.50:7272/casa-de-luis.');
  const server = await api.getServerBySlug(parsed.baseUrl, parsed.slug);
  await enterServer(parsed.baseUrl, server.id, nickname, displayName);
}

/** Vuelve a pedir el servidor (nombre, canales, estado) y valida la sesión. */
export async function refreshSession(key: string): Promise<void> {
  const session = getSession(key);
  if (!session) return;
  // El historial guardado se ve aunque el servidor esté apagado o lejos.
  hydrate(key);
  let server: Server;
  try {
    server = await api.getServer(session.baseUrl, session.serverId);
  } catch (error) {
    const problem = asApiError(error);
    if (problem.status === 404) {
      useApp.setState((s) => ({ unreachable: { ...s.unreachable, [key]: 'Este servidor ya no existe.' } }));
      stopBus(key);
    } else {
      useApp.setState((s) => ({ unreachable: { ...s.unreachable, [key]: problem.message } }));
    }
    return;
  }

  useApp.setState((s) => {
    const { [key]: _ok, ...unreachable } = s.unreachable;
    return { servers: { ...s.servers, [key]: server }, unreachable };
  });
  if (server.name !== session.name || server.slug !== session.slug) {
    useSessions.getState().update(key, { name: server.name, slug: server.slug });
  }

  if (!session.expired) {
    try {
      const me = await api.me(session.baseUrl, session.token);
      useSessions.getState().update(key, { member: me.member });
    } catch (error) {
      if (asApiError(error).status === 401) markExpired(key);
    }
  }

  void loadMembers(key);
  const fresh = getSession(key);
  if (fresh && !fresh.expired && server.status === 'active') startBus(fresh, server);
  else stopBus(key);
}

function markExpired(key: string): void {
  const session = getSession(key);
  if (!session || session.expired) return;
  useSessions.getState().update(key, { expired: true });
  stopBus(key);
  toast(`Tu sesión en ${session.name} venció. Volvé a entrar con tu nickname.`, 'error');
}

export async function loadMembers(key: string): Promise<void> {
  const session = getSession(key);
  if (!session) return;
  try {
    const page = await api.members(session.baseUrl, session.serverId);
    useApp.setState((s) => ({ members: { ...s.members, [key]: page.items } }));
  } catch {
    // se reintenta en la próxima actualización
  }
}

/** Vuelve a entrar a una sesión vencida, con el mismo nickname. */
export function reenter(key: string): void {
  const session = getSession(key);
  if (!session) return;
  openModal({ kind: 'enter', serverId: session.serverId, serverName: session.name, baseUrl: session.baseUrl });
}

export function confirmLeave(key: string): void {
  const session = getSession(key);
  if (!session) return;
  openModal({
    kind: 'confirm',
    title: `Salir de ${session.name}`,
    text: 'Dejás de ser miembro. Si volvés a entrar con el mismo nickname, lo recuperás. El historial que guardó esta app se borra.',
    action: 'Salir del servidor',
    danger: true,
    onConfirm: async () => {
      try {
        await api.leave(session.baseUrl, session.serverId, session.token);
      } catch (error) {
        // si el servidor no responde, igual se sale de este lado
        if (asApiError(error).status !== 0 && asApiError(error).status !== 401) throw error;
      }
      dropSession(key);
      toast(`Saliste de ${session.name}`);
    },
  });
}

function dropSession(key: string): void {
  if (useVoice.getState().call?.key === key) leaveVoice();
  stopBus(key);
  forget(key);
  useSessions.getState().remove(key);
  useApp.setState((s) => {
    const { [key]: _s, ...servers } = s.servers;
    const { [key]: _m, ...members } = s.members;
    const { [key]: _u, ...unreachable } = s.unreachable;
    return { servers, members, unreachable, view: currentKey(s.view) === key ? { kind: 'home' } : s.view };
  });
}

// ─── Navegación ───────────────────────────────────────────────────────────────

export function goHome(): void {
  useApp.setState({ view: { kind: 'home' }, wofiOpen: false });
  useSettings.getState().set({ lastView: 'home' });
}

export function defaultChannel(server: Server | undefined): string | null {
  const text = (server?.channels ?? []).filter((c) => c.kind === 'text');
  return (text.find((c) => c.is_default) ?? [...text].sort((a, b) => a.position - b.position)[0])?.id ?? null;
}

export function selectSession(key: string): void {
  const session = getSession(key);
  if (!session) return;
  const server = useApp.getState().servers[key];
  const channelId =
    session.lastChannelId && server?.channels.some((c) => c.id === session.lastChannelId)
      ? session.lastChannelId
      : defaultChannel(server);
  if (channelId) selectChannel(key, channelId);
  else useApp.setState({ view: { kind: 'channel', key, channelId: '' } });
}

export function selectChannel(key: string, channelId: string): void {
  useApp.setState({ view: { kind: 'channel', key, channelId }, wofiOpen: false });
  useSessions.getState().update(key, { lastChannelId: channelId });
  useSettings.getState().set({ lastView: `${key}#${channelId}` });
  markRead(key, channelId);
}

export function selectDm(key: string, peerId: string): void {
  useApp.setState({ view: { kind: 'dm', key, peerId }, wofiOpen: false });
  const selfId = getSession(key)?.member.id;
  if (selfId) markRead(key, dmChannel(selfId, peerId));
}

/** El canal de chat de lo que se está mirando (`dm:…` en un mensaje directo). */
export function channelKeyOf(view: View): string | null {
  if (view.kind === 'channel') return view.channelId;
  if (view.kind === 'dm') {
    const selfId = getSession(view.key)?.member.id;
    return selfId ? dmChannel(selfId, view.peerId) : null;
  }
  return null;
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────

const MAX_LENGTH = 2000;

export async function sendText(key: string, channelId: string, text: string, replyTo: string | null): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    await runCommand(key, channelId, trimmed);
    return;
  }
  post(key, channelId, trimmed.replace(/^\/\//, '/'), replyTo);
}

const lonelyNoticeAt = new Map<string, number>();

function post(key: string, channelId: string, content: string, replyTo: string | null = null): void {
  const session = getSession(key);
  const bus = getBus(key);
  if (!session || !bus) {
    toast('Este servidor no está conectado: no se puede escribir.', 'error');
    return;
  }
  if (content.length > MAX_LENGTH) {
    toast(`El mensaje es muy largo (máximo ${MAX_LENGTH} caracteres).`, 'error');
    return;
  }
  const now = Date.now();
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    channelId,
    authorId: bus.selfId,
    nick: session.member.nickname,
    name: session.member.display_name,
    content,
    createdAt: now,
    updatedAt: now,
    replyTo,
    reactions: {},
  };
  const delivered = bus.send(message);
  markRead(key, channelId);
  // Al llegar el mensaje, los demás dejan de ver "escribiendo": si seguís
  // escribiendo, el próximo aviso tiene que salir enseguida.
  typingSentAt.delete(`${key}#${channelId}`);

  // Avisar una vez cada tanto que el mensaje todavía no le llegó a nadie.
  const noticeKey = `${key}#${channelId}`;
  if (!delivered && now - (lonelyNoticeAt.get(noticeKey) ?? 0) > 10 * 60_000) {
    lonelyNoticeAt.set(noticeKey, now);
    addNotice(
      key,
      channelId,
      isDm(channelId)
        ? 'Esta persona no está conectada. El mensaje queda en tu app y le llega cuando se conecte y vos también estés.'
        : 'No hay nadie más conectado ahora. El mensaje queda en tu app y le llega a cada uno cuando se conecte mientras vos estés.',
    );
  }
}

async function runCommand(key: string, channelId: string, raw: string): Promise<void> {
  const [name = '', ...rest] = raw.slice(1).split(' ');
  const arg = rest.join(' ').trim();
  const session = getSession(key);
  switch (name.toLowerCase()) {
    case 'help':
      addNotice(
        key,
        channelId,
        ['Comandos:', ...slashCommands.map((c) => `\`/${c.name}${c.args ? ` ${c.args}` : ''}\` — ${c.description}`)].join('\n'),
      );
      return;
    case 'ping': {
      if (!session) return;
      try {
        const ms = await api.ping(session.baseUrl);
        addNotice(key, channelId, `🏓 pong · ${Math.round(ms)} ms hasta ${hostOf(session.baseUrl)} · ${getBus(key)?.connectedPeers().length ?? 0} personas conectadas por P2P`);
      } catch (error) {
        addNotice(key, channelId, `Sin respuesta de ${hostOf(session.baseUrl)}: ${errorText(error)}`);
      }
      return;
    }
    case 'shrug':
      post(key, channelId, `${arg} ¯\\_(ツ)_/¯`.trim());
      return;
    case 'tableflip':
      post(key, channelId, `${arg} (╯°□°)╯︵ ┻━┻`.trim());
      return;
    case 'unflip':
      post(key, channelId, `${arg} ┬─┬ ノ( ゜-゜ノ)`.trim());
      return;
    case 'me':
      if (arg) post(key, channelId, `*${arg}*`);
      else addNotice(key, channelId, 'Uso: `/me se fue a hacer mate`');
      return;
    case 'status':
      setStatus(useSettings.getState().presence, arg);
      addNotice(key, channelId, arg ? `Tu estado ahora es: ${arg}` : 'Borraste tu estado.');
      return;
    case 'nick':
      if (!arg) addNotice(key, channelId, 'Uso: `/nick Ana Paula`');
      else await renameMe(key, arg);
      return;
    case 'clear':
      clearChannel(key, channelId);
      addNotice(key, channelId, 'Borraste el historial de este canal en tu app. Las de los demás no cambian.');
      return;
    default:
      addNotice(key, channelId, `No existe el comando \`/${name}\`. Probá \`/help\`.`);
  }
}

export function toggleReaction(key: string, channelId: string, id: string, emoji: string): void {
  const bus = getBus(key);
  const message = findMessage(key, channelId, id);
  if (!bus || !message) return;
  bus.react(channelId, id, emoji, !(message.reactions[emoji] ?? []).includes(bus.selfId));
}

export function deleteMessage(key: string, channelId: string, id: string): void {
  getBus(key)?.delete(channelId, id);
}

const typingSentAt = new Map<string, number>();

export function notifyTyping(key: string, channelId: string): void {
  const k = `${key}#${channelId}`;
  const now = Date.now();
  if (now - (typingSentAt.get(k) ?? 0) < 2500) return;
  typingSentAt.set(k, now);
  getBus(key)?.typing(channelId);
}

// ─── Perfil y estado ──────────────────────────────────────────────────────────

export function setStatus(presence: Presence, text: string): void {
  useSettings.getState().set({ presence, statusText: text.slice(0, 128) });
  for (const bus of allBuses()) bus.announcePresence();
}

export async function renameMe(key: string, displayName: string): Promise<void> {
  const session = getSession(key);
  if (!session) return;
  try {
    const member = await api.updateMe(session.baseUrl, session.token, displayName.trim());
    useSessions.getState().update(key, { member });
    replaceMember(key, member);
    toast(`En ${session.name} ahora sos ${member.display_name}`, 'success');
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

function replaceMember(key: string, member: Member): void {
  useApp.setState((s) => ({
    members: { ...s.members, [key]: (s.members[key] ?? []).map((m) => (m.id === member.id ? member : m)) },
  }));
}

export async function setMemberRole(key: string, nickname: string, role: 'admin' | 'member'): Promise<void> {
  const session = getSession(key);
  if (!session) return;
  try {
    const member = await api.setRole(session.baseUrl, session.serverId, session.token, nickname, role);
    replaceMember(key, member);
    toast(`${member.display_name} ahora es ${role === 'admin' ? 'admin' : 'miembro'}`, 'success');
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

export function confirmKick(key: string, member: Member): void {
  const session = getSession(key);
  if (!session) return;
  openModal({
    kind: 'confirm',
    title: `Echar a ${member.display_name}`,
    text: `Sale de ${session.name}. Puede volver a entrar si tiene la dirección.`,
    action: 'Echar',
    danger: true,
    onConfirm: async () => {
      await api.kick(session.baseUrl, session.serverId, session.token, member.nickname);
      await loadMembers(key);
      toast(`${member.display_name} ya no está en ${session.name}`);
    },
  });
}

// ─── Voz ──────────────────────────────────────────────────────────────────────

let voice: VoiceSession | null = null;

export async function openVoice(key: string, channelId: string): Promise<void> {
  const session = getSession(key);
  const server = useApp.getState().servers[key];
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!session || !server || !channel) return;

  useApp.setState({ view: { kind: 'voice', key, channelId }, wofiOpen: false });
  if (voice && voice.key === key && voice.channelId === channelId) return;

  voice?.end();
  voice = new VoiceSession({
    session,
    channelId,
    channelName: channel.name,
    serverName: server.name,
    onDropped: (reason) => {
      voice = null;
      toast(`Se cortó la llamada: ${reason}`, 'error');
    },
  });
  try {
    await voice.start();
    void refreshVoiceRooms();
  } catch (error) {
    voice = null;
    toast(error instanceof VoiceError ? error.message : 'No se pudo entrar al canal de voz.', 'error');
  }
}

export function leaveVoice(): void {
  const call = useVoice.getState().call;
  voice?.end();
  voice = null;
  const view = useApp.getState().view;
  if (call && view.kind === 'voice') {
    const back = getSession(call.key)?.lastChannelId;
    if (back) selectChannel(call.key, back);
    else selectSession(call.key);
  }
  void refreshVoiceRooms();
}

export function toggleMute(): void {
  voice?.toggleMute();
}

export function toggleDeafen(): void {
  voice?.toggleDeafen();
}

/** Quién está en cada canal de voz del servidor que se está mirando. */
async function refreshVoiceRooms(): Promise<void> {
  const key = currentKey() ?? useVoice.getState().call?.key ?? null;
  const session = getSession(key);
  const server = key ? useApp.getState().servers[key] : undefined;
  if (!key || !session || !server || session.expired || server.status !== 'active') return;
  const rooms: Record<string, CallParticipant[]> = {};
  await Promise.all(
    server.channels
      .filter((c) => c.kind === 'voice')
      .map(async (channel) => {
        try {
          const page = await api.callParticipants(session.baseUrl, session.serverId, channel.id, session.token);
          rooms[channel.id] = page.participants;
        } catch {
          rooms[channel.id] = [];
        }
      }),
  );
  useApp.setState((s) => ({ voiceRooms: { ...s.voiceRooms, [key]: rooms } }));
}

// ─── Avisos ───────────────────────────────────────────────────────────────────

function isLooking(key: string, channelId: string): boolean {
  const view = useApp.getState().view;
  return !document.hidden && document.hasFocus() && currentKey(view) === key && channelKeyOf(view) === channelId;
}

busHooks.presence = () => {
  const { presence, statusText } = useSettings.getState();
  return { presence, text: statusText };
};

busHooks.onExpired = (key) => markExpired(key);

busHooks.onLive = (key, messages) => {
  const session = getSession(key);
  if (!session) return;
  for (const message of messages) {
    if (isLooking(key, message.channelId)) {
      markRead(key, message.channelId);
      continue;
    }
    const direct = isDm(message.channelId);
    const mentioned = mentionsIn(message.content).includes(session.member.nickname);
    if (!(direct || mentioned) || !useSettings.getState().notifications) continue;

    const channel = useApp.getState().servers[key]?.channels.find((c) => c.id === message.channelId);
    const where = direct ? `${message.name} (mensaje directo)` : `${message.name} en #${channel?.name ?? 'canal'} · ${session.name}`;
    try {
      const notification = new Notification(where, { body: plainText(message.content).slice(0, 180) });
      notification.onclick = () => {
        window.focus();
        if (direct) selectDm(key, message.authorId);
        else selectChannel(key, message.channelId);
      };
    } catch {
      // sin notificaciones del sistema; queda el contador
    }
  }
};

/** Cuando la ventana vuelve al frente, lo que se ve queda leído. */
export function markCurrentRead(): void {
  const view = useApp.getState().view;
  const key = currentKey(view);
  const channelId = channelKeyOf(view);
  if (key && channelId) markRead(key, channelId);
}

export function closeOverlays(): void {
  closeModal();
  useApp.setState({ wofiOpen: false, mentionsOpen: false });
}

/** Todas las menciones a vos y los DMs recibidos, de lo más nuevo a lo más viejo. */
export function mentionsOfMe(state = useChat.getState()): { key: string; message: ChatMessage }[] {
  const out: { key: string; message: ChatMessage }[] = [];
  for (const session of useSessions.getState().sessions) {
    for (const [channelId, list] of Object.entries(state.messages[session.key] ?? {})) {
      for (const message of list) {
        if (message.deleted || message.authorId === session.member.id) continue;
        if (isDm(channelId) || mentionsIn(message.content).includes(session.member.nickname)) {
          out.push({ key: session.key, message });
        }
      }
    }
  }
  return out.sort((a, b) => b.message.createdAt - a.message.createdAt).slice(0, 100);
}

