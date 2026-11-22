import { invoke, isTauri } from '@tauri-apps/api/core';

export interface StoredSession {
  token: string;
  base_url: string;
}

const KEY = 'hazel.session';

/** En Tauri el token vive en un archivo 0600 del app config; en el navegador, en localStorage. */
export async function loadStoredSession(): Promise<StoredSession | null> {
  if (isTauri()) {
    try {
      return await invoke<StoredSession | null>('load_session');
    } catch {
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

/** Solo en Tauri: lee HAZEL_ADMIN_TOKEN del .env local (nunca se muestra). */
export async function loadAdminToken(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('read_admin_token');
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredSession | null): Promise<void> {
  if (isTauri()) {
    try {
      if (session) {
        await invoke('save_session', { token: session.token, baseUrl: session.base_url });
      } else {
        await invoke('clear_session');
      }
    } catch {
      // No rompemos la sesión en memoria si falla la persistencia.
    }
    return;
  }
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
}
