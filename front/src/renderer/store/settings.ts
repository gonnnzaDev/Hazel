// Preferencias de esta app. Se guardan en esta compu y nada más.

import { create } from 'zustand';

import { load, save } from '../lib/storage';
import type { Presence } from '../lib/types';

const KEY = 'hazel2.settings';

export const DEFAULT_NODE_URL = 'http://127.0.0.1:7272';

export interface Settings {
  /** El nodo propio: donde se crean, encienden y apagan tus servidores. */
  nodeUrl: string;
  /** El último nickname usado, para no escribirlo cada vez. */
  lastNickname: string;
  /** Fondo con partículas animadas. */
  particles: boolean;
  /** Notificaciones del sistema cuando te mencionan o te escriben por privado. */
  notifications: boolean;
  /** Tu estado, el mismo en todos los servidores. */
  presence: Presence;
  statusText: string;
  /** Categorías de canales colapsadas: `${sessionKey}:${categoría}`. */
  collapsed: Record<string, boolean>;
  /** Panel de miembros visible en los canales. */
  showMembers: boolean;
  /** 'home' o `${sessionKey}#${canal}`: dónde quedaste al cerrar. */
  lastView: string;
}

const DEFAULTS: Settings = {
  nodeUrl: DEFAULT_NODE_URL,
  lastNickname: '',
  particles: true,
  notifications: true,
  presence: 'online',
  statusText: '',
  collapsed: {},
  showMembers: true,
  lastView: 'home',
};

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void;
  toggleCollapsed(key: string): void;
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...DEFAULTS,
  ...load<Partial<Settings>>(KEY, {}),
  set: (patch) => set(patch),
  toggleCollapsed: (key) => set({ collapsed: { ...get().collapsed, [key]: !get().collapsed[key] } }),
}));

useSettings.subscribe((state) => {
  const { set: _set, toggleCollapsed: _toggle, ...data } = state;
  save(KEY, data);
});
