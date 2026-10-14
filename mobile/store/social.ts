/** Amigos, solicitudes y mensajes directos. */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { DirectChannel, FriendRequest } from '@/api/types';
import { uid } from '@/lib/id';
import { directChannels, friendIds, friendRequests } from '@/mocks/social';
import { users } from '@/mocks/users';

import { normalizeUsername } from './auth';
import { storage } from './storage';

export function dmChannelId(userId: string): string {
  return `dm-${userId}`;
}

interface SocialState {
  friends: string[];
  requests: FriendRequest[];
  dms: DirectChannel[];
  /** No leídos por DM. */
  unread: Record<string, number>;

  acceptRequest(id: string): void;
  declineRequest(id: string): void;
  /** Lanza un error si no existe nadie con ese usuario. */
  sendRequest(username: string): void;
  removeFriend(userId: string): void;
  /** Abre (o crea) el DM con alguien y devuelve su id de canal. */
  openDm(userId: string): string;
  bumpUnread(dmId: string): void;
  markRead(dmId: string): void;
}

export const useSocial = create<SocialState>()(
  persist(
    (set, get) => ({
      friends: friendIds,
      requests: friendRequests,
      dms: directChannels,
      unread: { 'dm-u-ana': 1 },

      acceptRequest(id) {
        const request = get().requests.find((r) => r.id === id);
        if (!request) return;
        set((s) => ({
          requests: s.requests.filter((r) => r.id !== id),
          friends: s.friends.includes(request.userId) ? s.friends : [...s.friends, request.userId],
        }));
      },

      declineRequest(id) {
        set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      },

      sendRequest(raw) {
        const username = normalizeUsername(raw.replace(/^@/, ''));
        const user = users.find((u) => u.username === username);
        if (!user) throw new Error(`No encontramos a @${username || '…'}.`);
        const { friends, requests } = get();
        if (friends.includes(user.id)) throw new Error(`Ya sos amigo de ${user.displayName}.`);
        if (requests.some((r) => r.userId === user.id)) throw new Error('Ya hay una solicitud pendiente.');
        set({ requests: [...requests, { id: uid('fr'), userId: user.id, direction: 'outgoing' }] });
      },

      removeFriend(userId) {
        set((s) => ({ friends: s.friends.filter((id) => id !== userId) }));
      },

      openDm(userId) {
        const id = dmChannelId(userId);
        if (!get().dms.some((d) => d.id === id)) set((s) => ({ dms: [{ id, userId }, ...s.dms] }));
        return id;
      },

      bumpUnread(dmId) {
        set((s) => ({ unread: { ...s.unread, [dmId]: (s.unread[dmId] ?? 0) + 1 } }));
      },

      markRead(dmId) {
        if (!get().unread[dmId]) return;
        set((s) => ({ unread: { ...s.unread, [dmId]: 0 } }));
      },
    }),
    { name: 'recop.social', storage },
  ),
);
