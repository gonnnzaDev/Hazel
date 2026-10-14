/**
 * Servidores, canales y no leídos.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Channel, Role, Server } from '@/api/types';
import { uid } from '@/lib/id';
import { discoverableServers, servers as initialServers } from '@/mocks/servers';
import { ME_ID } from '@/mocks/users';

import { storage } from './storage';

const NEW_SERVER_ACCENTS = ['#00E5FF', '#A855F7', '#BFFF00', '#FF4D6D', '#FFB020'];

interface ServersState {
  servers: Server[];
  activeServerId: string;
  /** Categorías plegadas, por id. */
  collapsed: Record<string, boolean>;
  /** Mensajes sin leer, por canal. */
  unread: Record<string, number>;
  /** Menciones sin leer, por canal. */
  mentions: Record<string, number>;
  /** Canales silenciados: no suman a los badges. */
  muted: Record<string, boolean>;

  selectServer(id: string): void;
  toggleCategory(categoryId: string): void;
  markRead(channelId: string): void;
  /** Llegó un mensaje a un canal que no está abierto. */
  bumpUnread(channelId: string, mentionsMe: boolean): void;
  toggleMute(channelId: string): void;
  /** Entra a un servidor con su código. Lanza un error si el código no existe. */
  joinByInvite(code: string): Server;
  createServer(name: string, icon: string): Server;
  leaveServer(id: string): void;
}

export const useServers = create<ServersState>()(
  persist(
    (set, get) => ({
      servers: initialServers,
      activeServerId: initialServers[0]?.id ?? '',
      collapsed: {},
      unread: { 'ch-casa-general': 3, 'ch-hypr-dotfiles': 5, 'ch-gym-rutinas': 2, 'ch-casa-anuncios': 1 },
      mentions: { 'ch-casa-general': 1, 'ch-hypr-dotfiles': 1 },
      muted: {},

      selectServer(id) {
        set({ activeServerId: id });
      },

      toggleCategory(categoryId) {
        set((s) => ({ collapsed: { ...s.collapsed, [categoryId]: !s.collapsed[categoryId] } }));
      },

      markRead(channelId) {
        const { unread, mentions } = get();
        if (!unread[channelId] && !mentions[channelId]) return;
        set({ unread: { ...unread, [channelId]: 0 }, mentions: { ...mentions, [channelId]: 0 } });
      },

      bumpUnread(channelId, mentionsMe) {
        if (get().muted[channelId] && !mentionsMe) return;
        set((s) => ({
          unread: { ...s.unread, [channelId]: (s.unread[channelId] ?? 0) + 1 },
          mentions: mentionsMe ? { ...s.mentions, [channelId]: (s.mentions[channelId] ?? 0) + 1 } : s.mentions,
        }));
      },

      toggleMute(channelId) {
        set((s) => ({ muted: { ...s.muted, [channelId]: !s.muted[channelId] } }));
      },

      joinByInvite(rawCode) {
        // Acepta el código solo, `recop://código` o el enlace de un canal, `recop://código/canal`.
        const code = rawCode.trim().toLowerCase().replace(/^recop:\/\//, '').split('/')[0] ?? '';
        if (!code) throw new Error('Pegá un código de invitación.');
        const existing = get().servers.find((s) => s.inviteCode === code);
        if (existing) {
          set({ activeServerId: existing.id });
          return existing;
        }
        const found = discoverableServers.find((s) => s.inviteCode === code);
        if (!found) throw new Error(`No existe ninguna invitación "${code}". Probá con recop-dev.`);
        set((s) => ({ servers: [...s.servers, found], activeServerId: found.id }));
        return found;
      },

      createServer(rawName, icon) {
        const name = rawName.trim();
        if (name.length < 2) throw new Error('El nombre tiene que tener al menos 2 caracteres.');
        const id = uid('s');
        const accent = NEW_SERVER_ACCENTS[get().servers.length % NEW_SERVER_ACCENTS.length] ?? '#00E5FF';
        const owner: Role = { id: 'r-owner', name: 'Dueño', color: '#BFFF00', badge: 'star', position: 100 };
        const member: Role = { id: 'r-member', name: 'Miembro', color: '#8B98A9', position: 1 };
        const textCategory = { id: uid('c'), name: 'Texto' };
        const voiceCategory = { id: uid('c'), name: 'Voz' };
        const channels: Channel[] = [
          { id: uid('ch'), serverId: id, categoryId: textCategory.id, name: 'general', type: 'text', topic: '¡Arrancamos!' },
          { id: uid('ch'), serverId: id, categoryId: voiceCategory.id, name: 'charla', type: 'voice' },
        ];
        const server: Server = {
          id,
          name,
          icon: icon.trim() || name.charAt(0).toUpperCase(),
          accent,
          banner: [accent, '#0a0e14'],
          description: 'Un servidor nuevo, recién desplegado.',
          inviteCode: name
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
          ownerId: ME_ID,
          roles: [owner, member],
          categories: [textCategory, voiceCategory],
          channels,
          members: [{ userId: ME_ID, roleIds: ['r-owner'] }],
        };
        set((s) => ({ servers: [...s.servers, server], activeServerId: id }));
        return server;
      },

      leaveServer(id) {
        const servers = get().servers.filter((s) => s.id !== id);
        set({ servers, activeServerId: servers[0]?.id ?? '' });
      },
    }),
    { name: 'recop.servers', storage },
  ),
);

// ─── Consultas ────────────────────────────────────────────────────────────────

export function findChannel(channelId: string): { server: Server; channel: Channel } | null {
  for (const server of useServers.getState().servers) {
    const channel = server.channels.find((c) => c.id === channelId);
    if (channel) return { server, channel };
  }
  return null;
}

/** El rol más alto de alguien en un servidor (el que le da color al nombre). */
export function topRole(server: Server | undefined, userId: string): Role | undefined {
  if (!server) return undefined;
  const member = server.members.find((m) => m.userId === userId);
  if (!member) return undefined;
  return server.roles
    .filter((r) => member.roleIds.includes(r.id))
    .sort((a, b) => b.position - a.position)[0];
}

/** No leídos y menciones de un servidor entero, para los badges del dock. */
export function serverBadges(
  server: Server,
  unread: Record<string, number>,
  mentions: Record<string, number>,
  muted: Record<string, boolean>,
): { unread: number; mentions: number } {
  let u = 0;
  let m = 0;
  for (const channel of server.channels) {
    if (!muted[channel.id]) u += unread[channel.id] ?? 0;
    m += mentions[channel.id] ?? 0;
  }
  return { unread: u, mentions: m };
}
