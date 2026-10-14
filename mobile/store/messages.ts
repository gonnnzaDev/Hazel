/**
 * Mensajes de canales, hilos y DMs: historial, paginación, "escribiendo…",
 * reacciones, hilos y los comandos `/`.
 */

import { create } from 'zustand';

import type { Message, Thread } from '@/api/types';
import { uid } from '@/lib/id';
import { slashCommands } from '@/mocks/commands';
import { initialMessages, threads as initialThreads } from '@/mocks/messages';
import { ME_ID } from '@/mocks/users';

import { useAuth } from './auth';
import { useNet } from './net';
import { allUsers } from './people';
import { useServers } from './servers';
import { useSocial } from './social';
import { useUi } from './ui';

const PAGE = 25;
const TYPING_TTL_MS = 6000;
export const SYSTEM_ID = 'system';

type SentListener = (message: Message) => void;
const sentListeners = new Set<SentListener>();

/** Para la capa de red: avisa cada mensaje que manda la persona. */
export function onMessageSent(listener: SentListener): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

interface MessagesState {
  byChannel: Record<string, Message[]>;
  /** Cuántos de los últimos mensajes de cada canal están cargados. */
  loaded: Record<string, number>;
  loadingOlder: Record<string, boolean>;
  /** Quién escribe en cada canal y hasta cuándo se lo muestra. */
  typing: Record<string, Record<string, number>>;
  threads: Thread[];
  /** El canal que está en pantalla: lo que llega ahí no suma no leídos. */
  openChannelId: string | null;

  setOpenChannel(channelId: string | null): void;
  send(channelId: string, content: string): void;
  receive(message: Message): void;
  loadOlder(channelId: string): Promise<void>;
  setTyping(channelId: string, userId: string, typing: boolean): void;
  toggleReaction(channelId: string, messageId: string, emoji: string): void;
  deleteMessage(channelId: string, messageId: string): void;
  /** Abre un hilo desde un mensaje (o devuelve el que ya existe). */
  openThread(channelId: string, messageId: string): string;
}

// ─── Comandos y menciones ─────────────────────────────────────────────────────

/** "@ana hola" → "<@u-ana> hola", para cualquier usuario conocido. */
function encodeMentions(content: string): { content: string; mentions: string[] } {
  const byUsername = new Map(allUsers().map((u) => [u.username, u.id]));
  const mentions: string[] = [];
  const encoded = content.replace(/(^|\s)@([a-z0-9._-]+)/gi, (match, space: string, name: string) => {
    const id = byUsername.get(name.toLowerCase());
    if (!id) return match;
    mentions.push(id);
    return `${space}<@${id}>`;
  });
  return { content: encoded, mentions };
}

function systemMessage(channelId: string, content: string): Message {
  return { id: uid('sys'), channelId, authorId: SYSTEM_ID, content, createdAt: Date.now(), reactions: [], mentions: [], system: true };
}

/**
 * Aplica un comando `/`. Devuelve el texto a enviar, o `null` si el comando ya
 * hizo lo suyo y no hay nada que mandar.
 */
function runCommand(raw: string, addSystem: (text: string) => void, clear: () => void): string | null {
  const [, name = '', args = ''] = raw.match(/^\/(\S+)\s*([\s\S]*)$/) ?? [];
  const text = args.trim();
  switch (name.toLowerCase()) {
    case 'help':
      addSystem(
        ['**Comandos disponibles**', ...slashCommands.map((c) => `\`/${c.name}${c.args ? ` ${c.args}` : ''}\` — ${c.description}`)].join(
          '\n',
        ),
      );
      return null;
    case 'ping': {
      const latency = useNet.getState().latency;
      addSystem(latency === null ? '🏓 Pong — todavía midiendo la latencia…' : `🏓 Pong — \`${latency} ms\` con el servidor`);
      return null;
    }
    case 'shrug':
      return `${text} ¯\\_(ツ)_/¯`.trim();
    case 'tableflip':
      return `${text} (╯°□°)╯︵ ┻━┻`.trim();
    case 'unflip':
      return `${text} ┬─┬ ノ( ゜-゜ノ)`.trim();
    case 'me':
      return text ? `*${text}*` : null;
    case 'status':
      useAuth.getState().setCustomStatus(text);
      addSystem(text ? `Tu estado ahora es: _${text}_` : 'Borraste tu estado.');
      return null;
    case 'nick':
      if (!text) {
        addSystem('Usá `/nick <nombre>`.');
        return null;
      }
      useAuth.getState().updateUser({ displayName: text.slice(0, 64) });
      addSystem(`Ahora te ven como **${text.slice(0, 64)}**.`);
      return null;
    case 'clear':
      clear();
      return null;
    default:
      addSystem(`No conozco \`/${name}\`. Probá \`/help\`.`);
      return null;
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMessages = create<MessagesState>()((set, get) => {
  const append = (message: Message) =>
    set((s) => {
      const list = s.byChannel[message.channelId] ?? [];
      if (list.some((m) => m.id === message.id)) return s;
      return {
        byChannel: { ...s.byChannel, [message.channelId]: [...list, message] },
        loaded: { ...s.loaded, [message.channelId]: (s.loaded[message.channelId] ?? PAGE) + 1 },
      };
    });

  const patch = (channelId: string, messageId: string, change: (m: Message) => Message) =>
    set((s) => ({
      byChannel: {
        ...s.byChannel,
        [channelId]: (s.byChannel[channelId] ?? []).map((m) => (m.id === messageId ? change(m) : m)),
      },
    }));

  return {
    byChannel: initialMessages,
    loaded: {},
    loadingOlder: {},
    typing: {},
    threads: initialThreads,
    openChannelId: null,

    setOpenChannel(channelId) {
      set({ openChannelId: channelId });
      if (!channelId) return;
      if (channelId.startsWith('dm-')) useSocial.getState().markRead(channelId);
      else useServers.getState().markRead(channelId);
    },

    send(channelId, raw) {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const ui = useUi.getState();
      const replyToId = ui.replyTo[channelId];
      ui.setReplyTo(channelId, undefined);

      let text: string | null = trimmed;
      if (trimmed.startsWith('/')) {
        text = runCommand(
          trimmed,
          (content) => append(systemMessage(channelId, content)),
          () => set((s) => ({ byChannel: { ...s.byChannel, [channelId]: [] } })),
        );
      }
      if (!text) return;

      const { content, mentions } = encodeMentions(text);
      const message: Message = {
        id: uid('m'),
        channelId,
        authorId: ME_ID,
        content,
        createdAt: Date.now(),
        replyToId,
        reactions: [],
        mentions,
        pending: true,
      };
      append(message);

      // Como si el servidor confirmara la recepción.
      setTimeout(() => {
        patch(channelId, message.id, (m) => ({ ...m, pending: false }));
        for (const listener of sentListeners) listener({ ...message, pending: false });
      }, 350);
    },

    receive(message) {
      append(message);
      get().setTyping(message.channelId, message.authorId, false);
      if (message.channelId === get().openChannelId || message.authorId === ME_ID) return;
      if (message.channelId.startsWith('dm-')) useSocial.getState().bumpUnread(message.channelId);
      else useServers.getState().bumpUnread(message.channelId, message.mentions.includes(ME_ID));
    },

    async loadOlder(channelId) {
      const { byChannel, loaded, loadingOlder } = get();
      const total = byChannel[channelId]?.length ?? 0;
      const current = loaded[channelId] ?? PAGE;
      if (loadingOlder[channelId] || current >= total) return;
      set({ loadingOlder: { ...loadingOlder, [channelId]: true } });
      await new Promise((resolve) => setTimeout(resolve, 450)); // como si viniera de la red
      set((s) => ({
        loaded: { ...s.loaded, [channelId]: current + PAGE },
        loadingOlder: { ...s.loadingOlder, [channelId]: false },
      }));
    },

    setTyping(channelId, userId, typing) {
      set((s) => {
        const room = { ...(s.typing[channelId] ?? {}) };
        if (typing) room[userId] = Date.now() + TYPING_TTL_MS;
        else delete room[userId];
        return { typing: { ...s.typing, [channelId]: room } };
      });
      if (typing) {
        setTimeout(() => {
          const until = get().typing[channelId]?.[userId];
          if (until && until <= Date.now()) get().setTyping(channelId, userId, false);
        }, TYPING_TTL_MS + 50);
      }
    },

    toggleReaction(channelId, messageId, emoji) {
      patch(channelId, messageId, (m) => {
        const existing = m.reactions.find((r) => r.emoji === emoji);
        let reactions;
        if (!existing) reactions = [...m.reactions, { emoji, userIds: [ME_ID] }];
        else if (existing.userIds.includes(ME_ID)) {
          reactions = m.reactions
            .map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.filter((id) => id !== ME_ID) } : r))
            .filter((r) => r.userIds.length > 0);
        } else {
          reactions = m.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, ME_ID] } : r));
        }
        return { ...m, reactions };
      });
    },

    deleteMessage(channelId, messageId) {
      set((s) => ({
        byChannel: { ...s.byChannel, [channelId]: (s.byChannel[channelId] ?? []).filter((m) => m.id !== messageId) },
      }));
    },

    openThread(channelId, messageId) {
      const message = get().byChannel[channelId]?.find((m) => m.id === messageId);
      if (message?.threadId) return message.threadId;
      const id = uid('t');
      const preview = message?.content.replace(/<@[\w-]+>|[*_~`>]/g, '').trim() ?? '';
      const name = preview.slice(0, 32) || 'Hilo nuevo';
      set((s) => ({ threads: [...s.threads, { id, channelId, parentMessageId: messageId, name }] }));
      patch(channelId, messageId, (m) => ({ ...m, threadId: id }));
      return id;
    },
  };
});

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Los mensajes cargados de un canal (los últimos `loaded`). */
export function visibleMessages(all: Message[] | undefined, loaded: number | undefined): Message[] {
  const list = all ?? [];
  return list.slice(Math.max(0, list.length - (loaded ?? PAGE)));
}

export function hasOlder(all: Message[] | undefined, loaded: number | undefined): boolean {
  return (all?.length ?? 0) > (loaded ?? PAGE);
}

/** Todas las menciones a la persona logueada, de la más nueva a la más vieja. */
export function mentionsOfMe(byChannel: Record<string, Message[]>): Message[] {
  return Object.values(byChannel)
    .flat()
    .filter((m) => m.mentions.includes(ME_ID) && m.authorId !== ME_ID)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function findMessage(channelId: string, messageId: string): Message | undefined {
  return useMessages.getState().byChannel[channelId]?.find((m) => m.id === messageId);
}
