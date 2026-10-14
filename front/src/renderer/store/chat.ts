// El chat: mensajes, leídos, presencia y quién está escribiendo.
//
// El backend todavía no guarda mensajes. Cada app guarda el historial que vio
// (acá, en esta compu) y se lo pasa a quien se conecta (ver net/bus.ts). Por
// eso los mensajes se fusionan: el mismo mensaje puede llegar de varias
// personas, y gana la versión con `updatedAt` más nuevo.

import { create } from 'zustand';

import { mentionsIn } from '../lib/markdown';
import { debouncedSaver, load, remove } from '../lib/storage';
import type { ChatMessage, LocalNotice, Presence } from '../lib/types';

/** Cuántos mensajes se guardan por canal. Los más viejos se descartan. */
export const KEEP_PER_CHANNEL = 500;

export type BusStatus = 'connecting' | 'online' | 'offline' | 'expired' | 'stopped';

export interface PeerPresence {
  /** Tiene la app abierta y conectada a este servidor ahora mismo. */
  online: boolean;
  presence: Presence;
  text: string;
}

interface Persisted {
  messages: Record<string, ChatMessage[]>;
  lastRead: Record<string, number>;
}

interface ChatStore {
  /** Por sesión → por canal (o `dm:…`) → mensajes ordenados por fecha. */
  messages: Record<string, Record<string, ChatMessage[]>>;
  notices: Record<string, Record<string, LocalNotice[]>>;
  lastRead: Record<string, Record<string, number>>;
  presence: Record<string, Record<string, PeerPresence>>;
  /** Por sesión → canal → persona → hasta cuándo se muestra "escribiendo". */
  typing: Record<string, Record<string, Record<string, number>>>;
  bus: Record<string, { status: BusStatus; selfId: string | null; connected: string[]; error: string | null }>;
}

export const useChat = create<ChatStore>()(() => ({
  messages: {},
  notices: {},
  lastRead: {},
  presence: {},
  typing: {},
  bus: {},
}));

// ─── Guardado ─────────────────────────────────────────────────────────────────

const storageKey = (sessionKey: string) => `hazel2.chat.${sessionKey}`;
const saveLater = debouncedSaver(800);

function persist(sessionKey: string): void {
  saveLater(storageKey(sessionKey), (): Persisted => {
    const { messages, lastRead } = useChat.getState();
    return { messages: messages[sessionKey] ?? {}, lastRead: lastRead[sessionKey] ?? {} };
  });
}

/** Trae del disco lo que esta app ya había visto en ese servidor. */
export function hydrate(sessionKey: string): void {
  if (useChat.getState().messages[sessionKey]) return;
  const stored = load<Persisted>(storageKey(sessionKey), { messages: {}, lastRead: {} });
  useChat.setState((s) => ({
    messages: { ...s.messages, [sessionKey]: stored.messages },
    lastRead: { ...s.lastRead, [sessionKey]: stored.lastRead },
  }));
}

/** Borra todo lo de una sesión (al salir del servidor o borrarlo). */
export function forget(sessionKey: string): void {
  remove(storageKey(sessionKey));
  useChat.setState((s) => {
    const without = <T,>(record: Record<string, T>) => {
      const { [sessionKey]: _gone, ...rest } = record;
      return rest;
    };
    return {
      messages: without(s.messages),
      notices: without(s.notices),
      lastRead: without(s.lastRead),
      presence: without(s.presence),
      typing: without(s.typing),
      bus: without(s.bus),
    };
  });
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────

export function dmChannel(a: string, b: string): string {
  return `dm:${[a, b].sort().join(':')}`;
}

export function isDm(channelKey: string): boolean {
  return channelKey.startsWith('dm:');
}

/** La otra persona de un DM. */
export function dmPeer(channelKey: string, selfId: string): string {
  const [, a = '', b = ''] = channelKey.split(':');
  return a === selfId ? b : a;
}

/**
 * Suma o actualiza mensajes. Devuelve los que no estaban (para avisar de
 * menciones y contar no leídos), no los que solo cambiaron.
 */
export function upsertMessages(sessionKey: string, items: ChatMessage[]): ChatMessage[] {
  if (!items.length) return [];
  const added: ChatMessage[] = [];
  useChat.setState((s) => {
    const byChannel = { ...(s.messages[sessionKey] ?? {}) };
    const grouped = new Map<string, ChatMessage[]>();
    for (const item of items) grouped.set(item.channelId, [...(grouped.get(item.channelId) ?? []), item]);

    for (const [channelId, incoming] of grouped) {
      const current = byChannel[channelId] ?? [];
      const index = new Map(current.map((m, i) => [m.id, i]));
      const next = [...current];
      let needsSort = false;
      for (const item of incoming) {
        const at = index.get(item.id);
        if (at === undefined) {
          index.set(item.id, next.length);
          next.push(item);
          added.push(item);
          needsSort = true;
        } else if ((next[at]?.updatedAt ?? 0) < item.updatedAt) {
          next[at] = item;
        }
      }
      if (needsSort) next.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      byChannel[channelId] = next.slice(-KEEP_PER_CHANNEL);
    }
    return { messages: { ...s.messages, [sessionKey]: byChannel } };
  });
  persist(sessionKey);
  return added;
}

export function findMessage(sessionKey: string, channelId: string, id: string): ChatMessage | undefined {
  return useChat.getState().messages[sessionKey]?.[channelId]?.find((m) => m.id === id);
}

/** Pone o saca una reacción de alguien. Devuelve el mensaje actualizado. */
export function applyReaction(
  sessionKey: string,
  channelId: string,
  id: string,
  emoji: string,
  memberId: string,
  on: boolean,
  at: number,
): ChatMessage | null {
  const message = findMessage(sessionKey, channelId, id);
  if (!message) return null;
  const people = new Set(message.reactions[emoji] ?? []);
  if (on === people.has(memberId)) return null;
  if (on) people.add(memberId);
  else people.delete(memberId);
  const reactions = { ...message.reactions, [emoji]: [...people] };
  if (!people.size) delete reactions[emoji];
  const updated = { ...message, reactions, updatedAt: Math.max(message.updatedAt + 1, at) };
  upsertMessages(sessionKey, [updated]);
  return updated;
}

/** Borra el historial de un canal en esta app (no en las de los demás). */
export function clearChannel(sessionKey: string, channelId: string): void {
  useChat.setState((s) => ({
    messages: { ...s.messages, [sessionKey]: { ...(s.messages[sessionKey] ?? {}), [channelId]: [] } },
    notices: { ...s.notices, [sessionKey]: { ...(s.notices[sessionKey] ?? {}), [channelId]: [] } },
  }));
  persist(sessionKey);
}

/** Lo más nuevo que hay de cada canal: con eso se pide lo que falta al conectar. */
export function heads(sessionKey: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [channelId, list] of Object.entries(useChat.getState().messages[sessionKey] ?? {})) {
    out[channelId] = list.reduce((max, m) => Math.max(max, m.updatedAt), 0);
  }
  return out;
}

// ─── Avisos locales ───────────────────────────────────────────────────────────

export function addNotice(sessionKey: string, channelId: string, content: string): void {
  const notice: LocalNotice = { id: crypto.randomUUID(), channelId, content, createdAt: Date.now() };
  useChat.setState((s) => {
    const byChannel = s.notices[sessionKey] ?? {};
    return {
      notices: {
        ...s.notices,
        [sessionKey]: { ...byChannel, [channelId]: [...(byChannel[channelId] ?? []).slice(-20), notice] },
      },
    };
  });
}

// ─── Leídos ───────────────────────────────────────────────────────────────────

export function markRead(sessionKey: string, channelId: string): void {
  const list = useChat.getState().messages[sessionKey]?.[channelId] ?? [];
  const last = list[list.length - 1]?.createdAt ?? Date.now();
  const current = useChat.getState().lastRead[sessionKey]?.[channelId] ?? 0;
  if (current >= last) return;
  useChat.setState((s) => ({
    lastRead: { ...s.lastRead, [sessionKey]: { ...(s.lastRead[sessionKey] ?? {}), [channelId]: last } },
  }));
  persist(sessionKey);
}

export interface Unread {
  count: number;
  mentions: number;
}

/** No leídos y menciones de un canal, sin contar lo propio ni lo borrado. */
export function unreadOf(
  state: ChatStore,
  sessionKey: string,
  channelId: string,
  selfId: string | null,
  selfNick: string,
): Unread {
  const list = state.messages[sessionKey]?.[channelId];
  if (!list?.length) return { count: 0, mentions: 0 };
  const read = state.lastRead[sessionKey]?.[channelId] ?? 0;
  let count = 0;
  let mentions = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.createdAt <= read) break;
    if (m.deleted || m.authorId === selfId) continue;
    count += 1;
    if (isDm(channelId) || mentionsIn(m.content).includes(selfNick)) mentions += 1;
  }
  return { count, mentions };
}

/** Todo lo de una sesión sumado (para el dock y la barra). */
export function unreadOfSession(state: ChatStore, sessionKey: string, selfId: string | null, selfNick: string): Unread {
  let count = 0;
  let mentions = 0;
  for (const channelId of Object.keys(state.messages[sessionKey] ?? {})) {
    const u = unreadOf(state, sessionKey, channelId, selfId, selfNick);
    count += u.count;
    mentions += u.mentions;
  }
  return { count, mentions };
}

// ─── Presencia y "escribiendo" ────────────────────────────────────────────────

export function setPresence(sessionKey: string, memberId: string, patch: Partial<PeerPresence>): void {
  useChat.setState((s) => {
    const bySession = s.presence[sessionKey] ?? {};
    const current = bySession[memberId] ?? { online: false, presence: 'online' as Presence, text: '' };
    return { presence: { ...s.presence, [sessionKey]: { ...bySession, [memberId]: { ...current, ...patch } } } };
  });
}

export function setAllOffline(sessionKey: string): void {
  useChat.setState((s) => {
    const bySession = s.presence[sessionKey] ?? {};
    const next: Record<string, PeerPresence> = {};
    for (const [id, p] of Object.entries(bySession)) next[id] = { ...p, online: false };
    return { presence: { ...s.presence, [sessionKey]: next }, typing: { ...s.typing, [sessionKey]: {} } };
  });
}

export const TYPING_TTL_MS = 6000;

export function setTyping(sessionKey: string, channelId: string, memberId: string, typing: boolean): void {
  useChat.setState((s) => {
    const bySession = s.typing[sessionKey] ?? {};
    const byChannel = { ...(bySession[channelId] ?? {}) };
    if (typing) byChannel[memberId] = Date.now() + TYPING_TTL_MS;
    else delete byChannel[memberId];
    return { typing: { ...s.typing, [sessionKey]: { ...bySession, [channelId]: byChannel } } };
  });
}

export function setBus(sessionKey: string, patch: Partial<ChatStore['bus'][string]>): void {
  useChat.setState((s) => {
    const current = s.bus[sessionKey] ?? { status: 'connecting' as BusStatus, selfId: null, connected: [], error: null };
    return { bus: { ...s.bus, [sessionKey]: { ...current, ...patch } } };
  });
}
