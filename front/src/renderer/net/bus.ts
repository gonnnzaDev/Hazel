// El chat de un servidor, de app a app.
//
// El backend todavía no guarda mensajes, pero sí presenta a la gente: su
// WebSocket de llamadas acepta cualquier canal. Cada app entra a la "sala" del
// canal de texto por defecto del servidor y abre un canal de datos WebRTC con
// cada persona conectada (ver net/mesh.ts). Por ahí viajan los mensajes de
// todos los canales, las reacciones, quién está escribiendo, el estado de cada
// uno y los mensajes directos (que van solo a la otra persona).
//
// El historial lo guarda cada app. Al conectarse, dos apps se cuentan qué es lo
// último que tienen de cada canal (`hello`) y cada una le manda a la otra lo
// que le falta (`sync`). Así, quien llega ve lo que se habló mientras no estaba,
// siempre que alguien que lo vio esté conectado.
//
// Protocolo (versión 1), todo JSON:
//   hello    { t, v, presence, text, heads: { canal: updatedAt } }
//   sync     { t, items: ChatMessage[] }
//   msg      { t, m: ChatMessage }             mensaje nuevo (o DM, solo al destinatario)
//   react    { t, ch, id, emoji, on, at }
//   delete   { t, ch, id, at }                 solo quien lo escribió
//   typing   { t, ch }
//   presence { t, presence, text }

import { mentionsIn } from '../lib/markdown';
import type { ChatMessage, Presence, Server, Session } from '../lib/types';
import {
  applyReaction,
  dmChannel,
  findMessage,
  heads,
  hydrate,
  isDm,
  setAllOffline,
  setBus,
  setPresence,
  setTyping,
  upsertMessages,
  useChat,
} from '../store/chat';
import { AUTH_CLOSE_CODES, MeshError, PeerMesh, roomUrl } from './mesh';

const PROTOCOL = 1;
const SYNC_BATCH = 40;
const SYNC_LIMIT_PER_CHANNEL = 300;
const MAX_CONTENT = 4000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

type Frame =
  | { t: 'hello'; v: number; presence: Presence; text: string; heads: Record<string, number> }
  | { t: 'sync'; items: unknown[] }
  | { t: 'msg'; m: unknown }
  | { t: 'react'; ch: string; id: string; emoji: string; on: boolean; at: number }
  | { t: 'delete'; ch: string; id: string; at: number }
  | { t: 'typing'; ch: string }
  | { t: 'presence'; presence: Presence; text: string };

export interface BusHooks {
  /** Llegaron mensajes nuevos en vivo (no por sincronización). */
  onLive?(sessionKey: string, messages: ChatMessage[]): void;
  /** La sesión venció: hay que volver a entrar con el nickname. */
  onExpired?(sessionKey: string): void;
  /** Lo que esta app manda como estado propio. */
  presence(): { presence: Presence; text: string };
}

export const busHooks: BusHooks = { presence: () => ({ presence: 'online', text: '' }) };

function str(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length <= max;
}

const PRESENCES = new Set<Presence>(['online', 'idle', 'dnd']);

/** Revisa que algo que llegó de otra app sea un mensaje bien formado. */
function asMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (!str(m['id'], 80) || !str(m['channelId'], 200) || !str(m['authorId'], 80)) return null;
  if (!str(m['nick'], 64) || !str(m['name'], 128) || !str(m['content'], MAX_CONTENT)) return null;
  if (typeof m['createdAt'] !== 'number' || typeof m['updatedAt'] !== 'number') return null;
  const reactions: Record<string, string[]> = {};
  const raw = m['reactions'];
  if (raw && typeof raw === 'object') {
    for (const [emoji, people] of Object.entries(raw as Record<string, unknown>)) {
      if (str(emoji, 16) && Array.isArray(people)) reactions[emoji] = people.filter((p): p is string => str(p, 80));
    }
  }
  return {
    id: m['id'],
    channelId: m['channelId'],
    authorId: m['authorId'],
    nick: m['nick'],
    name: m['name'],
    content: m['content'],
    createdAt: m['createdAt'],
    updatedAt: m['updatedAt'],
    replyTo: str(m['replyTo'], 80) ? m['replyTo'] : null,
    reactions,
    deleted: m['deleted'] === true,
  };
}

/** El canal donde se juntan todos: el de texto por defecto, igual para todas las apps. */
export function busChannelOf(server: Server): string | null {
  const text = server.channels.filter((c) => c.kind === 'text');
  const chosen =
    text.find((c) => c.is_default) ?? [...text].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0];
  return chosen?.id ?? null;
}

export class ChatBus {
  readonly key: string;
  private session: Session;
  private server: Server;
  private mesh: PeerMesh | null = null;
  private stopped = false;
  private retryMs = RECONNECT_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(session: Session, server: Server) {
    this.key = session.key;
    this.session = session;
    this.server = server;
  }

  get selfId(): string {
    return this.mesh?.selfId ?? this.session.member.id;
  }

  /** Datos nuevos de la sesión o del servidor (nombre, canales, token). */
  refresh(session: Session, server: Server): void {
    const roomChanged = busChannelOf(server) !== busChannelOf(this.server);
    this.session = session;
    this.server = server;
    if (roomChanged && !this.stopped) this.reconnect();
  }

  start(): void {
    this.stopped = false;
    hydrate(this.key);
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.mesh?.close();
    this.mesh = null;
    setAllOffline(this.key);
    setBus(this.key, { status: 'stopped', connected: [] });
  }

  private reconnect(): void {
    this.mesh?.close();
    this.mesh = null;
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const room = busChannelOf(this.server);
    if (!room) {
      setBus(this.key, { status: 'offline', error: 'El servidor no tiene canales de texto.' });
      return;
    }
    setBus(this.key, { status: 'connecting', error: null });

    const mesh = new PeerMesh({
      url: roomUrl(this.session.baseUrl, this.session.serverId, room, this.session.token),
      data: true,
      handlers: {
        welcome: (selfId, peers) => {
          setBus(this.key, { status: 'online', selfId, connected: [], error: null });
          setPresence(this.key, selfId, { online: true, ...busHooks.presence() });
          for (const peer of peers) setPresence(this.key, peer.member_id, { online: true });
        },
        peerJoined: (peer) => setPresence(this.key, peer.member_id, { online: true }),
        peerLeft: (memberId) => {
          setPresence(this.key, memberId, { online: false });
          for (const channelId of Object.keys(useChat.getState().typing[this.key] ?? {})) {
            setTyping(this.key, channelId, memberId, false);
          }
          this.updateConnected();
        },
        open: (memberId) => {
          this.updateConnected();
          this.sendTo(memberId, { t: 'hello', v: PROTOCOL, ...busHooks.presence(), heads: heads(this.key) });
        },
        message: (memberId, data) => this.receive(memberId, data),
        closed: (reason, code) => this.lost(reason, code),
      },
    });
    this.mesh = mesh;

    try {
      await mesh.start();
      this.retryMs = RECONNECT_MIN_MS;
    } catch (error) {
      if (this.mesh !== mesh) return;
      const code = error instanceof MeshError ? error.code : '';
      this.lost(error instanceof Error ? error.message : 'No se pudo conectar.', code);
    }
  }

  private lost(reason: string, code: string): void {
    this.mesh = null;
    setAllOffline(this.key);
    if (this.stopped) return;
    if (AUTH_CLOSE_CODES.has(code)) {
      setBus(this.key, { status: 'expired', connected: [], error: reason });
      busHooks.onExpired?.(this.key);
      return;
    }
    setBus(this.key, { status: 'offline', connected: [], error: reason });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(RECONNECT_MAX_MS, this.retryMs * 2);
  }

  private updateConnected(): void {
    setBus(this.key, { connected: this.mesh?.connected() ?? [] });
  }

  private sendTo(memberId: string, frame: Frame): boolean {
    return this.mesh?.send(memberId, frame) ?? false;
  }

  private broadcast(frame: Frame): number {
    return this.mesh?.broadcast(frame) ?? 0;
  }

  /** A quién va algo de ese canal: al otro si es un DM, a todos si no. */
  private deliver(channelId: string, frame: Frame): number {
    if (!isDm(channelId)) return this.broadcast(frame);
    const peer = channelId.split(':').slice(1).find((id) => id !== this.selfId);
    return peer && this.sendTo(peer, frame) ? 1 : 0;
  }

  // ─── Lo que hace esta app ────────────────────────────────────────────────────

  /** Manda un mensaje. Si nadie está conectado queda guardado y se entrega al conectar. */
  send(message: ChatMessage): number {
    upsertMessages(this.key, [message]);
    return this.deliver(message.channelId, { t: 'msg', m: message });
  }

  react(channelId: string, id: string, emoji: string, on: boolean): void {
    const at = Date.now();
    if (applyReaction(this.key, channelId, id, emoji, this.selfId, on, at)) {
      this.deliver(channelId, { t: 'react', ch: channelId, id, emoji, on, at });
    }
  }

  delete(channelId: string, id: string): void {
    const message = findMessage(this.key, channelId, id);
    if (!message || message.authorId !== this.selfId) return;
    const at = Math.max(Date.now(), message.updatedAt + 1);
    upsertMessages(this.key, [{ ...message, content: '', deleted: true, reactions: {}, updatedAt: at }]);
    this.deliver(channelId, { t: 'delete', ch: channelId, id, at });
  }

  typing(channelId: string): void {
    this.deliver(channelId, { t: 'typing', ch: channelId });
  }

  announcePresence(): void {
    const own = busHooks.presence();
    setPresence(this.key, this.selfId, own);
    this.broadcast({ t: 'presence', ...own });
  }

  connectedPeers(): string[] {
    return this.mesh?.connected() ?? [];
  }

  // ─── Lo que llega de otras apps ──────────────────────────────────────────────

  private receive(from: string, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const frame = data as Frame;
    switch (frame.t) {
      case 'hello':
        if (PRESENCES.has(frame.presence)) {
          setPresence(this.key, from, { online: true, presence: frame.presence, text: str(frame.text, 128) ? frame.text : '' });
        }
        this.syncTo(from, frame.heads && typeof frame.heads === 'object' ? frame.heads : {});
        return;
      case 'sync': {
        if (!Array.isArray(frame.items)) return;
        const items = frame.items.map(asMessage).filter((m): m is ChatMessage => m !== null && this.accepts(m));
        upsertMessages(this.key, items);
        return;
      }
      case 'msg': {
        const message = asMessage(frame.m);
        // En vivo, cada uno solo puede mandar mensajes propios.
        if (!message || message.authorId !== from || !this.accepts(message)) return;
        setTyping(this.key, message.channelId, from, false);
        const added = upsertMessages(this.key, [message]);
        if (added.length) busHooks.onLive?.(this.key, added);
        return;
      }
      case 'react':
        if (str(frame.ch) && str(frame.id, 80) && str(frame.emoji, 16) && typeof frame.on === 'boolean') {
          applyReaction(this.key, frame.ch, frame.id, frame.emoji, from, frame.on, Number(frame.at) || Date.now());
        }
        return;
      case 'delete': {
        if (!str(frame.ch) || !str(frame.id, 80)) return;
        const message = findMessage(this.key, frame.ch, frame.id);
        if (!message || message.authorId !== from) return;
        const at = Math.max(Number(frame.at) || Date.now(), message.updatedAt + 1);
        upsertMessages(this.key, [{ ...message, content: '', deleted: true, reactions: {}, updatedAt: at }]);
        return;
      }
      case 'typing':
        if (str(frame.ch) && (!isDm(frame.ch) || frame.ch === dmChannel(from, this.selfId))) {
          setTyping(this.key, frame.ch, from, true);
        }
        return;
      case 'presence':
        if (PRESENCES.has(frame.presence)) {
          setPresence(this.key, from, { online: true, presence: frame.presence, text: str(frame.text, 128) ? frame.text : '' });
        }
        return;
      default:
        return; // de una versión más nueva: se ignora
    }
  }

  /** Un DM ajeno no se guarda: solo los canales del servidor y los DMs propios. */
  private accepts(message: ChatMessage): boolean {
    if (!isDm(message.channelId)) return this.server.channels.some((c) => c.id === message.channelId);
    return message.channelId.split(':').includes(this.selfId);
  }

  /** Le manda a alguien lo que esta app tiene y esa persona no. */
  private syncTo(memberId: string, theirHeads: Record<string, number>): void {
    const all = useChat.getState().messages[this.key] ?? {};
    const own = dmChannel(this.selfId, memberId);
    const pending: ChatMessage[] = [];
    for (const [channelId, list] of Object.entries(all)) {
      if (isDm(channelId) && channelId !== own) continue;
      const since = Number(theirHeads[channelId]) || 0;
      pending.push(...list.filter((m) => m.updatedAt > since).slice(-SYNC_LIMIT_PER_CHANNEL));
    }
    for (let i = 0; i < pending.length; i += SYNC_BATCH) {
      this.sendTo(memberId, { t: 'sync', items: pending.slice(i, i + SYNC_BATCH) });
    }
  }
}

// ─── Una por sesión ───────────────────────────────────────────────────────────

const buses = new Map<string, ChatBus>();

export function startBus(session: Session, server: Server): ChatBus {
  const existing = buses.get(session.key);
  if (existing) {
    existing.refresh(session, server);
    return existing;
  }
  const bus = new ChatBus(session, server);
  buses.set(session.key, bus);
  bus.start();
  return bus;
}

export function stopBus(key: string): void {
  buses.get(key)?.stop();
  buses.delete(key);
}

export function getBus(key: string): ChatBus | undefined {
  return buses.get(key);
}

export function allBuses(): ChatBus[] {
  return [...buses.values()];
}

/** ¿Este mensaje nombra a esta persona? */
export function mentions(message: ChatMessage, nick: string): boolean {
  return mentionsIn(message.content).includes(nick);
}
