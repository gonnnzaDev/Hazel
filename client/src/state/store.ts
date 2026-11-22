import { create } from 'zustand';
import { HazelClient } from '../api/client';
import { friendlyError } from '../api/errors';
import {
  messageSchema,
  type HazelEvent,
  type Member,
  type Message,
  type NodeAddress,
  type Server,
  type ServerSummary,
} from '../api/schema';
import { HazelSocket, type ConnectionStatus } from '../api/ws';
import { loadStoredSession, saveStoredSession } from './session';

const client = new HazelClient('http://127.0.0.1:7272');
const typingTimers = new Map<string, number>();
let initialized = false;

const socket = new HazelSocket({
  onEvent: (event) => useAppStore.getState().handleEvent(event),
  onStatus: (status) => useAppStore.setState({ status }),
});

interface Session {
  token: string;
  member: Member;
  server: ServerSummary;
}

interface AppState {
  baseUrl: string;
  address: NodeAddress | null;
  status: ConnectionStatus;
  session: Session | null;
  servers: Server[];
  selectedServerId: string | null;
  selectedChannelId: string | null;
  messages: Record<string, Message[]>;
  cursors: Record<string, string | null>;
  presence: Record<string, boolean>;
  typing: Record<string, string[]>;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setBaseUrl: (value: string) => void;
  probeNode: () => Promise<NodeAddress | null>;
  loadServers: () => Promise<void>;
  join: (serverId: string, nickname: string, displayName?: string) => Promise<void>;
  createAndEnter: (
    payload: {
      name: string;
      slug: string;
      description?: string | null;
      owner_nickname: string;
    },
    adminToken: string,
  ) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMore: () => Promise<void>;
  send: (content: string) => Promise<void>;
  notifyTyping: () => void;
  applyMessage: (channelId: string, message: Message) => void;
  handleEvent: (event: HazelEvent) => void;
  logout: () => Promise<void>;
  clearError: () => void;
}

function firstChannel(server: Server): string | null {
  return server.channels.find((channel) => channel.is_default)?.id ?? server.channels[0]?.id ?? null;
}

function upsert(list: Message[], incoming: Message): Message[] {
  const index = list.findIndex((message) => message.id === incoming.id);
  if (index === -1) return [...list, incoming];
  const next = [...list];
  next[index] = incoming;
  return next;
}

export const useAppStore = create<AppState>((set, get) => ({
  baseUrl: 'http://127.0.0.1:7272',
  address: null,
  status: 'idle',
  session: null,
  servers: [],
  selectedServerId: null,
  selectedChannelId: null,
  messages: {},
  cursors: {},
  presence: {},
  typing: {},
  loading: false,
  error: null,

  async init() {
    if (initialized) return;
    initialized = true;
    const stored = await loadStoredSession();
    if (!stored?.token) return;
    set({ loading: true });
    client.setBaseUrl(stored.base_url);
    client.setToken(stored.token);
    try {
      const me = await client.me();
      set({
        baseUrl: stored.base_url,
        session: { token: stored.token, member: me.member, server: me.server },
        selectedServerId: me.server.id,
      });
      socket.connect(stored.base_url, stored.token);
      await get().loadServers();
      const server = get().servers.find((item) => item.id === me.server.id);
      const channelId = server ? firstChannel(server) : null;
      if (channelId) await get().selectChannel(channelId);
    } catch (error) {
      void saveStoredSession(null);
      client.setToken(undefined);
      socket.disconnect();
      set({ session: null, error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  setBaseUrl(value) {
    set({ baseUrl: value });
    client.setBaseUrl(value);
  },

  async probeNode() {
    set({ loading: true, error: null });
    try {
      client.setBaseUrl(get().baseUrl);
      const address = await client.getNodeAddress();
      set({ address });
      return address;
    } catch (error) {
      set({ error: friendlyError(error) });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  async loadServers() {
    try {
      const list = await client.listServers();
      set({ servers: list.items });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async join(serverId, nickname, displayName) {
    set({ loading: true, error: null });
    try {
      const result = await client.join(serverId, nickname, displayName);
      client.setToken(result.token);
      await saveStoredSession({ token: result.token, base_url: get().baseUrl });
      set({
        session: { token: result.token, member: result.member, server: result.server },
        selectedServerId: serverId,
      });
      socket.connect(get().baseUrl, result.token);
      await get().loadServers();
      const server = get().servers.find((item) => item.id === serverId);
      const channelId = server ? firstChannel(server) : null;
      if (channelId) await get().selectChannel(channelId);
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async createAndEnter(payload, adminToken) {
    set({ loading: true, error: null });
    try {
      const server = await client.createServer(payload, adminToken);
      const result = await client.join(server.id, payload.owner_nickname);
      client.setToken(result.token);
      await saveStoredSession({ token: result.token, base_url: get().baseUrl });
      set({
        session: { token: result.token, member: result.member, server: result.server },
        selectedServerId: server.id,
      });
      socket.connect(get().baseUrl, result.token);
      await get().loadServers();
      const channelId = firstChannel(server);
      if (channelId) await get().selectChannel(channelId);
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async selectChannel(channelId) {
    const previous = get().selectedChannelId;
    if (previous && previous !== channelId) socket.unsubscribe(previous);
    set({ selectedChannelId: channelId });
    socket.subscribe(channelId);
    if (get().messages[channelId]?.length) return;
    set({ loading: true, error: null });
    try {
      const list = await client.listMessages(channelId);
      set((state) => ({
        messages: { ...state.messages, [channelId]: [...list.items].reverse() },
        cursors: { ...state.cursors, [channelId]: list.next_cursor },
      }));
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async loadMore() {
    const channelId = get().selectedChannelId;
    const cursor = channelId ? get().cursors[channelId] : null;
    if (!channelId || !cursor || get().loading) return;
    set({ loading: true });
    try {
      const list = await client.listMessages(channelId, cursor);
      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: [...[...list.items].reverse(), ...(state.messages[channelId] ?? [])],
        },
        cursors: { ...state.cursors, [channelId]: list.next_cursor },
      }));
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async send(content) {
    const channelId = get().selectedChannelId;
    if (!channelId || !content.trim()) return;
    try {
      const message = await client.sendMessage(channelId, content.trim());
      get().applyMessage(channelId, message);
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  notifyTyping() {
    const channelId = get().selectedChannelId;
    if (channelId) socket.typing(channelId);
  },

  applyMessage(channelId, message) {
    set((state) => ({
      messages: { ...state.messages, [channelId]: upsert(state.messages[channelId] ?? [], message) },
    }));
  },

  handleEvent(event) {
    switch (event.type) {
      case 'message.created':
      case 'message.updated': {
        const parsed = messageSchema.safeParse(event.data);
        if (parsed.success && event.channel_id) {
          get().applyMessage(event.channel_id, parsed.data);
        }
        break;
      }
      case 'message.deleted': {
        const messageId = event.data.message_id;
        const channelId = event.channel_id;
        if (typeof messageId !== 'string' || !channelId) break;
        set((state) => {
          const list = state.messages[channelId];
          if (!list) return state;
          return {
            messages: {
              ...state.messages,
              [channelId]: list.map((message) =>
                message.id === messageId ? { ...message, content: null, deleted: true } : message,
              ),
            },
          };
        });
        break;
      }
      case 'presence.update': {
        const nickname = event.data.nickname;
        if (typeof nickname !== 'string') break;
        set((state) => ({
          presence: { ...state.presence, [nickname]: event.data.is_online === true },
        }));
        break;
      }
      case 'typing.start': {
        const channelId = event.channel_id;
        const nickname = event.data.nickname;
        if (!channelId || typeof nickname !== 'string') break;
        const key = `${channelId}:${nickname}`;
        const existing = typingTimers.get(key);
        if (existing !== undefined) window.clearTimeout(existing);
        typingTimers.set(
          key,
          window.setTimeout(() => {
            typingTimers.delete(key);
            set((state) => ({
              typing: {
                ...state.typing,
                [channelId]: (state.typing[channelId] ?? []).filter((name) => name !== nickname),
              },
            }));
          }, 3000),
        );
        set((state) => {
          const current = state.typing[channelId] ?? [];
          if (current.includes(nickname)) return state;
          return { typing: { ...state.typing, [channelId]: [...current, nickname] } };
        });
        break;
      }
      case 'error': {
        const detail = event.data.detail;
        set({ error: typeof detail === 'string' ? detail : 'Evento rechazado por el servidor' });
        break;
      }
      default:
        break;
    }
  },

  async logout() {
    initialized = false;
    socket.disconnect();
    try {
      await client.logout();
    } catch {
      // Revocar en el servidor es best-effort.
    }
    client.setToken(undefined);
    await saveStoredSession(null);
    set({
      session: null,
      messages: {},
      cursors: {},
      presence: {},
      typing: {},
      selectedChannelId: null,
      selectedServerId: null,
      address: null,
    });
  },

  clearError() {
    set({ error: null });
  },
}));
