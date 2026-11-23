import { create } from 'zustand';
import { HazelClient } from '../api/client';
import { friendlyError } from '../api/errors';
import {
  messageSchema,
  type AuditEventList,
  type Backup,
  type CallParticipants,
  type HazelEvent,
  type Invite,
  type Member,
  type Message,
  type NodeAddress,
  type Server,
  type ServerAddress,
  type ServerStats,
  type ServerSummary,
} from '../api/schema';
import { HazelSocket, type ConnectionStatus } from '../api/ws';
import { loadAdminToken, loadStoredSession, saveStoredSession, type JoinedServer } from './session';

const client = new HazelClient('http://127.0.0.1:7272');
const typingTimers = new Map<string, number>();
let initialized = false;

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('hazel.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Sin almacenamiento, se respeta la preferencia del sistema.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const startTheme = initialTheme();
document.documentElement.dataset.theme = startTheme;

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
  theme: Theme;
  toggleTheme: () => void;
  /** La conexión actual proviene de la máquina anfitriona del nodo. */
  canManage: boolean;
  status: ConnectionStatus;
  session: Session | null;
  joined: JoinedServer[];
  servers: Server[];
  members: Member[];
  stats: ServerStats | null;
  events: AuditEventList | null;
  serverAddress: ServerAddress | null;
  callParticipants: CallParticipants | null;
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
  join: (serverId: string, name: string) => Promise<void>;
  joinWithInvite: (code: string, name: string) => Promise<void>;
  createAndEnter: (
    payload: {
      name: string;
      slug: string;
      description?: string | null;
      owner_name: string;
    },
    adminToken: string,
  ) => Promise<void>;
  openServer: (serverId: string, token: string, joined: JoinedServer[]) => Promise<void>;
  selectJoinedServer: (serverId: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  rename: (name: string) => Promise<void>;
  updateServer: (payload: {
    name?: string;
    description?: string | null;
    max_members?: number;
  }) => Promise<boolean>;
  setServerStatus: (active: boolean) => Promise<boolean>;
  createChannel: (payload: {
    name: string;
    kind: 'text' | 'voice';
    topic?: string | null;
  }) => Promise<boolean>;
  updateChannel: (
    channelId: string,
    payload: { name?: string; topic?: string | null; position?: number },
  ) => Promise<boolean>;
  deleteChannel: (channelId: string) => Promise<boolean>;
  createInvite: (payload: {
    ttl_seconds?: number;
    single_use?: boolean;
    password?: string | null;
  }) => Promise<Invite | null>;
  deleteInvite: (code: string) => Promise<boolean>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMore: () => Promise<void>;
  send: (content: string) => Promise<void>;
  notifyTyping: () => void;
  applyMessage: (channelId: string, message: Message) => void;
  handleEvent: (event: HazelEvent) => void;
  logout: () => Promise<void>;
  clearError: () => void;
  loadMembers: () => Promise<void>;
  kickMember: (nickname: string) => Promise<boolean>;
  loadServerInfo: () => Promise<void>;
  createBackup: () => Promise<Backup | null>;
  restoreBackup: (backupId: string) => Promise<boolean>;
  refreshSession: () => Promise<boolean>;
  logoutAll: () => Promise<void>;
  sendHeartbeat: () => Promise<void>;
  editMessage: (channelId: string, messageId: string, content: string) => Promise<boolean>;
  deleteMessage: (channelId: string, messageId: string) => Promise<boolean>;
  react: (channelId: string, messageId: string, emoji: string, active: boolean) => Promise<void>;
  uploadAttachment: (channelId: string, messageId: string, file: File) => Promise<void>;
  downloadAttachment: (id: string, filename: string) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  loadCallParticipants: (channelId: string) => Promise<void>;
}

function withJoined(joined: JoinedServer[], entry: JoinedServer): JoinedServer[] {
  return [...joined.filter((item) => item.server_id !== entry.server_id), entry];
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
  theme: startTheme,
  toggleTheme() {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('hazel.theme', next);
    } catch {
      // El tema sigue aplicado mientras dure la sesión.
    }
    set({ theme: next });
  },
  canManage: false,
  status: 'idle',
  session: null,
  joined: [],
  servers: [],
  members: [],
  stats: null,
  events: null,
  serverAddress: null,
  callParticipants: null,
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
    if (stored?.joined) set({ joined: stored.joined });
    if (!stored?.token) return;
    set({ loading: true });
    client.setBaseUrl(stored.base_url);
    client.setToken(stored.token);
    try {
      const info = await client.getNodeInfo();
      set({ canManage: info.can_manage });
      const me = await client.me();
      let joined = get().joined;
      // Sesiones antiguas o parciales: asegurar que el servidor activo siempre
      // esté en el registro, aunque haya otras entradas guardadas.
      if (!joined.some((item) => item.server_id === me.server.id)) {
        joined = withJoined(joined, {
          server_id: me.server.id,
          token: stored.token,
          base_url: stored.base_url,
          name: me.server.name,
          slug: me.server.slug,
        });
        set({ joined });
        await saveStoredSession({ token: stored.token, base_url: stored.base_url, joined });
      }
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
      const [address, info] = await Promise.all([
        client.getNodeAddress(),
        client.getNodeInfo(),
      ]);
      set({ address, canManage: info.can_manage });
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

  async openServer(serverId, token, joined) {
    set({ loading: true, error: null });
    client.setToken(token);
    try {
      await saveStoredSession({ token, base_url: get().baseUrl, joined });
      const me = await client.me();
      set({
        session: { token, member: me.member, server: me.server },
        selectedServerId: serverId,
      });
      socket.connect(get().baseUrl, token);
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

  async selectJoinedServer(serverId) {
    const entry = get().joined.find((item) => item.server_id === serverId);
    if (!entry) return;
    await get().openServer(serverId, entry.token, get().joined);
  },

  async leaveServer(serverId) {
    const state = get();
    const entry = state.joined.find((item) => item.server_id === serverId);
    if (!entry) return;
    set({ loading: true, error: null });

    // El cliente usa un solo token: prestamos el de esta membresía para salir.
    const previousToken = client.token;
    client.setToken(entry.token);
    try {
      await client.leave(serverId);
    } catch {
      // Si el servidor ya no responde, igual lo quitamos del registro local.
    } finally {
      client.setToken(previousToken);
    }

    const joined = get().joined.filter((item) => item.server_id !== serverId);
    set({ joined });
    await saveStoredSession({
      token: state.session?.token ?? '',
      base_url: state.baseUrl,
      joined,
    });

    if (state.selectedServerId === serverId) {
      const next = joined.find((item) => item.base_url === state.baseUrl) ?? joined[0];
      if (next) {
        client.setBaseUrl(next.base_url);
        await get().openServer(next.server_id, next.token, joined);
      } else {
        socket.disconnect();
        await saveStoredSession(null);
        set({
          session: null,
          selectedServerId: null,
          selectedChannelId: null,
          messages: {},
          cursors: {},
          presence: {},
          typing: {},
          address: null,
        });
      }
    }
    set({ loading: false });
  },

  async deleteServer(serverId) {
    const state = get();
    set({ loading: true, error: null });
    // El borrado es una acción del host: si el nodo aún usa la autorización
    // antigua, el token de miembro daría `wrong_server` al borrar otro servidor.
    const previousToken = client.token;
    const adminToken = await loadAdminToken().catch(() => null);
    if (adminToken) client.setToken(adminToken);
    try {
      await client.deleteServer(serverId);
    } catch (error) {
      set({ error: friendlyError(error), loading: false });
      return;
    } finally {
      client.setToken(previousToken);
    }

    const joined = get().joined.filter((item) => item.server_id !== serverId);
    set({ joined });
    await saveStoredSession({
      token: state.session?.token ?? '',
      base_url: state.baseUrl,
      joined,
    });
    await get().loadServers();

    if (state.selectedServerId === serverId) {
      const next = joined.find((item) => item.base_url === state.baseUrl) ?? joined[0];
      if (next) {
        client.setBaseUrl(next.base_url);
        await get().openServer(next.server_id, next.token, joined);
      } else {
        socket.disconnect();
        await saveStoredSession(null);
        set({
          session: null,
          selectedServerId: null,
          selectedChannelId: null,
          messages: {},
          cursors: {},
          presence: {},
          typing: {},
          address: null,
        });
      }
    }
    set({ loading: false });
  },

  async join(serverId, name) {
    set({ loading: true, error: null });
    try {
      const result = await client.join(serverId, name);
      const entry: JoinedServer = {
        server_id: serverId,
        token: result.token,
        base_url: get().baseUrl,
        name: result.server.name,
        slug: result.server.slug,
      };
      const joined = withJoined(get().joined, entry);
      set({ joined });
      await get().openServer(serverId, result.token, joined);
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async joinWithInvite(code, name) {
    set({ loading: true, error: null });
    try {
      const invite = await client.getInvite(code.trim().toUpperCase());
      await get().join(invite.server_id, name.trim());
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
      const result = await client.join(server.id, payload.owner_name);
      const entry: JoinedServer = {
        server_id: server.id,
        token: result.token,
        base_url: get().baseUrl,
        name: server.name,
        slug: server.slug,
      };
      const joined = withJoined(get().joined, entry);
      set({ joined });
      await get().openServer(server.id, result.token, joined);
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async rename(name) {
    set({ loading: true, error: null });
    try {
      const member = await client.updateName(name);
      set((state) => ({
        session: state.session
          ? { ...state.session, member: { ...state.session.member, display_name: member.display_name } }
          : state.session,
      }));
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ loading: false });
    }
  },

  async updateServer(payload) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    set({ error: null });
    try {
      await client.updateServer(serverId, payload);
      await get().loadServers();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async setServerStatus(active) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    set({ error: null });
    try {
      await client.setServerStatus(serverId, active);
      await get().loadServers();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async createChannel(payload) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    set({ error: null });
    try {
      await client.createChannel(serverId, payload);
      await get().loadServers();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async updateChannel(channelId, payload) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    set({ error: null });
    try {
      await client.updateChannel(serverId, channelId, payload);
      await get().loadServers();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async deleteChannel(channelId) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    set({ error: null });
    try {
      await client.deleteChannel(serverId, channelId);
      if (get().selectedChannelId === channelId) {
        set({ selectedChannelId: null });
        socket.unsubscribe(channelId);
      }
      await get().loadServers();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async createInvite(payload) {
    const serverId = get().selectedServerId;
    if (!serverId) return null;
    set({ error: null });
    try {
      const invite = await client.createInvite(serverId, payload);
      return invite;
    } catch (error) {
      set({ error: friendlyError(error) });
      return null;
    }
  },

  async deleteInvite(code) {
    set({ error: null });
    try {
      await client.deleteInvite(code);
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async selectChannel(channelId) {
    const previous = get().selectedChannelId;
    if (previous && previous !== channelId) socket.unsubscribe(previous);
    set({ selectedChannelId: channelId });
    socket.subscribe(channelId);
    void client.joinChannel(channelId).catch(() => undefined);
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

  async loadMembers() {
    const serverId = get().selectedServerId;
    if (!serverId) return;
    try {
      const list = await client.listMembers(serverId);
      set({ members: list.items });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async kickMember(nickname) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    try {
      await client.kickMember(serverId, nickname);
      await get().loadMembers();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async loadServerInfo() {
    const serverId = get().selectedServerId;
    if (!serverId) return;
    try {
      const [stats, events, address] = await Promise.all([
        client.getServerStats(serverId),
        client.listAuditEvents(serverId),
        client.getServerAddress(serverId),
      ]);
      set({ stats, events, serverAddress: address });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async createBackup() {
    const serverId = get().selectedServerId;
    if (!serverId) return null;
    try {
      const backup = await client.createBackup(serverId);
      await get().loadServerInfo();
      return backup;
    } catch (error) {
      set({ error: friendlyError(error) });
      return null;
    }
  },

  async restoreBackup(backupId) {
    const serverId = get().selectedServerId;
    if (!serverId) return false;
    try {
      await client.restoreBackup(serverId, backupId);
      await get().loadServerInfo();
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async refreshSession() {
    const current = get().session;
    if (!current) return false;
    try {
      const result = await client.refreshToken();
      client.setToken(result.token);
      const me = await client.me();
      const joined = get().joined.map((item) =>
        item.server_id === me.server.id ? { ...item, token: result.token } : item,
      );
      set({ session: { ...current, token: result.token, member: me.member }, joined });
      await saveStoredSession({ token: result.token, base_url: get().baseUrl, joined });
      socket.connect(get().baseUrl, result.token);
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async logoutAll() {
    try {
      await client.logoutAll();
    } catch (error) {
      set({ error: friendlyError(error) });
    }
    await get().logout();
  },

  async sendHeartbeat() {
    const serverId = get().selectedServerId;
    if (!serverId) return;
    try {
      await client.heartbeat(serverId);
    } catch {
      // El heartbeat es best-effort; el supervisor también lo hace.
    }
  },

  async editMessage(channelId, messageId, content) {
    try {
      const updated = await client.editMessage(channelId, messageId, content);
      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: (state.messages[channelId] ?? []).map((item) =>
            item.id === messageId ? updated : item,
          ),
        },
      }));
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async deleteMessage(channelId, messageId) {
    try {
      await client.deleteMessage(channelId, messageId);
      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: (state.messages[channelId] ?? []).map((item) =>
            item.id === messageId ? { ...item, deleted: true, content: null } : item,
          ),
        },
      }));
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    }
  },

  async react(channelId, messageId, emoji, active) {
    try {
      if (active) await client.removeReaction(channelId, messageId, emoji);
      else await client.addReaction(channelId, messageId, emoji);
      const message = await client.getMessage(channelId, messageId);
      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: (state.messages[channelId] ?? []).map((item) =>
            item.id === messageId ? message : item,
          ),
        },
      }));
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async uploadAttachment(channelId, messageId, file) {
    try {
      await client.uploadAttachment(channelId, messageId, file);
      await get().selectChannel(channelId);
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async downloadAttachment(id, filename) {
    try {
      const blob = await client.downloadAttachment(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async deleteAttachment(id) {
    try {
      await client.deleteAttachment(id);
      set((state) => ({
        messages: Object.fromEntries(
          Object.entries(state.messages).map(([channel, list]) => [
            channel,
            list.map((message) => ({
              ...message,
              attachments: message.attachments.filter((item) => item !== id),
            })),
          ]),
        ),
      }));
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },

  async loadCallParticipants(channelId) {
    const serverId = get().selectedServerId;
    if (!serverId) return;
    try {
      const participants = await client.getCallParticipants(serverId, channelId);
      set({ callParticipants: participants });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
}));
