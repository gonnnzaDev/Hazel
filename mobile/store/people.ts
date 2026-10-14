/**
 * La gente: los usuarios de prueba más la persona logueada, con la presencia
 * que va llegando por el socket.
 */

import { create } from 'zustand';

import type { Presence, User } from '@/api/types';
import { ME_ID, users, usersById } from '@/mocks/users';

import { useAuth } from './auth';

interface PeopleState {
  /** Presencias que llegaron por el socket, por encima de las de prueba. */
  presence: Record<string, Presence>;
  setPresence(userId: string, presence: Presence): void;
}

export const usePeople = create<PeopleState>()((set) => ({
  presence: {},
  setPresence(userId, presence) {
    set((state) => ({ presence: { ...state.presence, [userId]: presence } }));
  },
}));

/** Un usuario por id, fuera de un componente. */
export function getUser(id: string): User | undefined {
  if (id === ME_ID) return useAuth.getState().user ?? undefined;
  const base = usersById[id];
  if (!base) return undefined;
  const presence = usePeople.getState().presence[id];
  return presence ? { ...base, presence } : base;
}

/** Un usuario por id, dentro de un componente (se actualiza solo). */
export function useUser(id: string | null | undefined): User | undefined {
  const me = useAuth((s) => s.user);
  const presence = usePeople((s) => (id ? s.presence[id] : undefined));
  if (!id) return undefined;
  if (id === ME_ID) return me ?? undefined;
  const base = usersById[id];
  if (!base) return undefined;
  return presence ? { ...base, presence } : base;
}

/** Todos, incluida la persona logueada. */
export function allUsers(): User[] {
  const me = useAuth.getState().user;
  return me ? [me, ...users] : users;
}

export function displayName(id: string): string {
  return getUser(id)?.displayName ?? 'alguien';
}
