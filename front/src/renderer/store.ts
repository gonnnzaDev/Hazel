// Lo que el cliente recuerda entre aperturas: preferencias y sesiones.
//
// En Recop no hay cuenta global. Cada servidor al que entrás te da un token
// propio, así que el cliente guarda una sesión por servidor (ver `Session`).
// Es lo que se ve en la barra de la izquierda.

import type { Session, Settings } from './types';

const SETTINGS_KEY = 'recop.settings.v1';
const SESSIONS_KEY = 'recop.sessions.v1';

const DEFAULT_SETTINGS: Settings = {
  nodeUrl: 'http://127.0.0.1:7272',
  theme: 'system',
  lastNickname: '',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado, disco lleno): la app sigue andando,
    // solo que no recuerda nada al cerrarse.
  }
}

// ─── Preferencias ─────────────────────────────────────────────────────────────

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export function updateSettings(changes: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...changes };
  write(SETTINGS_KEY, next);
  return next;
}

// ─── Sesiones ─────────────────────────────────────────────────────────────────

// La clave junta dirección y servidor: el mismo servidor visto desde dos
// direcciones (127.0.0.1 y la IP de la red) son dos sesiones distintas.
export function sessionKey(baseUrl: string, serverId: string): string {
  return `${baseUrl}|${serverId}`;
}

export function listSessions(): Session[] {
  return read<Session[]>(SESSIONS_KEY, []);
}

export function getSession(key: string): Session | null {
  return listSessions().find((s) => s.key === key) ?? null;
}

export function findSessionByServerId(serverId: string): Session | null {
  return listSessions().find((s) => s.serverId === serverId) ?? null;
}

export function saveSession(session: Session): Session {
  const sessions = listSessions();
  const index = sessions.findIndex((s) => s.key === session.key);
  if (index >= 0) sessions[index] = { ...sessions[index], ...session };
  else sessions.push(session);
  write(SESSIONS_KEY, sessions);
  return session;
}

// Cambia algunos campos de una sesión que ya existe. Si no existe, no hace nada.
export function patchSession(key: string, changes: Partial<Session>): void {
  const current = getSession(key);
  if (current) saveSession({ ...current, ...changes });
}

export function removeSession(key: string): void {
  write(
    SESSIONS_KEY,
    listSessions().filter((s) => s.key !== key),
  );
}
