// Lo que el cliente recuerda entre aperturas: preferencias y sesiones.
//
// En Recop no hay cuenta global. Cada servidor al que entrás te da un token
// propio, así que el cliente guarda una "sesión" por servidor: dónde está,
// con qué nickname entraste y el token. Es lo que se ve en la barra de la
// izquierda.

(function (R) {
  'use strict';

  const SETTINGS_KEY = 'recop.settings.v1';
  const SESSIONS_KEY = 'recop.sessions.v1';

  const DEFAULT_SETTINGS = {
    nodeUrl: 'http://127.0.0.1:7272',
    theme: 'system', // system | light | dark
    lastNickname: '',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Sin almacenamiento (modo privado, disco lleno): la app sigue andando,
      // solo que no recuerda nada al cerrarse.
    }
  }

  // ─── Preferencias ───────────────────────────────────────────────────────────

  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
  }

  function updateSettings(changes) {
    const next = { ...getSettings(), ...changes };
    write(SETTINGS_KEY, next);
    return next;
  }

  // ─── Sesiones ───────────────────────────────────────────────────────────────

  // La clave junta dirección y servidor: el mismo servidor visto desde dos
  // direcciones (127.0.0.1 y la IP de la red) son dos sesiones distintas.
  function sessionKey(baseUrl, serverId) {
    return `${baseUrl}|${serverId}`;
  }

  function listSessions() {
    return read(SESSIONS_KEY, []);
  }

  function getSession(key) {
    return listSessions().find((s) => s.key === key) || null;
  }

  function findSessionByServerId(serverId) {
    return listSessions().find((s) => s.serverId === serverId) || null;
  }

  function saveSession(session) {
    const sessions = listSessions();
    const index = sessions.findIndex((s) => s.key === session.key);
    if (index >= 0) sessions[index] = { ...sessions[index], ...session };
    else sessions.push(session);
    write(SESSIONS_KEY, sessions);
    return session;
  }

  function removeSession(key) {
    write(
      SESSIONS_KEY,
      listSessions().filter((s) => s.key !== key),
    );
  }

  R.store = {
    getSettings,
    updateSettings,
    sessionKey,
    listSessions,
    getSession,
    findSessionByServerId,
    saveSession,
    removeSession,
  };
})(window.Recop);
