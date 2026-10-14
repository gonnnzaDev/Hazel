// Los servidores en los que entraste: dirección, nickname y token de cada uno.
// En Hazel no hay cuenta global, así que esto es "tu cuenta" en cada servidor.

import { create } from 'zustand';

import { load, save } from '../lib/storage';
import type { Session } from '../lib/types';

const KEY = 'hazel2.sessions';

interface SessionsStore {
  sessions: Session[];
  upsert(session: Session): void;
  update(key: string, patch: Partial<Session>): void;
  remove(key: string): void;
}

export const useSessions = create<SessionsStore>()((set, get) => ({
  sessions: load<Session[]>(KEY, []),
  upsert: (session) => {
    const others = get().sessions.filter((s) => s.key !== session.key);
    const index = get().sessions.findIndex((s) => s.key === session.key);
    const sessions = [...others];
    sessions.splice(index < 0 ? sessions.length : index, 0, session);
    set({ sessions });
  },
  update: (key, patch) => set({ sessions: get().sessions.map((s) => (s.key === key ? { ...s, ...patch } : s)) }),
  remove: (key) => set({ sessions: get().sessions.filter((s) => s.key !== key) }),
}));

useSessions.subscribe((state) => save(KEY, state.sessions));

export function sessionKey(baseUrl: string, serverId: string): string {
  return `${baseUrl}|${serverId}`;
}

export function getSession(key: string | null | undefined): Session | undefined {
  return key ? useSessions.getState().sessions.find((s) => s.key === key) : undefined;
}
