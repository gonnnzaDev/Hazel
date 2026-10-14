/**
 * Sesión de prueba: login y registro sin backend.
 *
 * En Recop real no hay cuentas globales (cada servidor te da un token al
 * entrar con un nickname, ver api/client.ts). Este login de prueba existe para
 * recorrer la app completa; el nombre de usuario sigue las mismas reglas que
 * un nickname de Recop.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Activity, Presence, User } from '@/api/types';
import { ME_ID } from '@/mocks/users';

import { storage } from './storage';

const AVATAR_COLORS = ['#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#2563EB'];

/** Igual que `apps/common/nickname.py::normalize`: "  José  Luis " → "jose_luis". */
export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
}

function validate(username: string, password: string): string {
  const normalized = normalizeUsername(username);
  if (normalized.length < 2) throw new Error('El usuario tiene que tener al menos 2 caracteres.');
  if (normalized.length > 32) throw new Error('El usuario no puede superar los 32 caracteres.');
  if (password.length < 4) throw new Error('La contraseña tiene que tener al menos 4 caracteres.');
  return normalized;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function newUser(username: string, displayName: string): User {
  const color = AVATAR_COLORS[username.length % AVATAR_COLORS.length] ?? '#7C3AED';
  return {
    id: ME_ID,
    username,
    displayName: displayName || username.charAt(0).toUpperCase() + username.slice(1),
    avatarColor: color,
    banner: ['#00E5FF', '#A855F7'],
    presence: 'online',
    customStatus: 'recién llegado a recop',
    activity: { kind: 'coding', name: 'Recop Mobile', details: 'probando el modo Hypr', startedAt: Date.now() },
  };
}

interface AuthState {
  user: User | null;
  /** Si ya eligió con qué servidor arrancar. */
  onboarded: boolean;
  login(username: string, password: string): Promise<void>;
  register(input: { username: string; displayName: string; password: string }): Promise<void>;
  logout(): void;
  completeOnboarding(): void;
  updateUser(changes: Partial<Omit<User, 'id'>>): void;
  setPresence(presence: Presence): void;
  setCustomStatus(status: string): void;
  setActivity(activity: Activity | undefined): void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      onboarded: false,

      async login(username, password) {
        const normalized = validate(username, password);
        await wait(700); // como si fuera a un servidor
        set({ user: newUser(normalized, ''), onboarded: true });
      },

      async register({ username, displayName, password }) {
        const normalized = validate(username, password);
        if (!displayName.trim()) throw new Error('Elegí cómo te van a ver los demás.');
        await wait(900);
        set({ user: newUser(normalized, displayName.trim().slice(0, 64)), onboarded: false });
      },

      logout() {
        set({ user: null, onboarded: false });
      },

      completeOnboarding() {
        set({ onboarded: true });
      },

      updateUser(changes) {
        const user = get().user;
        if (user) set({ user: { ...user, ...changes } });
      },

      setPresence(presence) {
        get().updateUser({ presence });
      },

      setCustomStatus(status) {
        get().updateUser({ customStatus: status.trim() || undefined });
      },

      setActivity(activity) {
        get().updateUser({ activity });
      },
    }),
    { name: 'recop.auth', storage },
  ),
);
