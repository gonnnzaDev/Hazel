// Utilidades sin estado: construir DOM, formatear fechas y normalizar nombres.
//
// Todo el cliente cuelga de `window.Recop`. Son scripts clásicos (sin
// bundler ni módulos) a propósito: se cargan en orden desde index.html y
// funcionan igual en Electron y en un navegador.

window.Recop = window.Recop || {};

(function (R) {
  'use strict';

  // ─── DOM ────────────────────────────────────────────────────────────────────

  // h('button', { class: 'btn', onclick: fn }, 'Texto', otroNodo)
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'html')
        el.innerHTML = value; // solo para íconos propios, nunca texto de usuario
      else if (key === 'dataset') Object.assign(el.dataset, value);
      // Por CSSOM y no por atributo: la CSP de la ventana bloquea `style="…"`.
      else if (key === 'style') Object.assign(el.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
    append(el, ...children);
    return el;
  }

  // Como `Element.append`, pero acepta arreglos anidados y descarta null/false.
  function append(el, ...children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // ─── Nombres ────────────────────────────────────────────────────────────────

  function stripAccents(value) {
    return value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }

  // Igual que `apps/common/nickname.py::normalize`: "  José  Luis " → "jose_luis".
  function normalizeNickname(raw) {
    return stripAccents(String(raw).trim().toLowerCase())
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '');
  }

  // Igual que `apps/servers/services.py::normalize_slug`: "Casa de Luis" → "casa-de-luis".
  function normalizeSlug(raw) {
    return stripAccents(String(raw).trim().toLowerCase())
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function words(name) {
    return String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  // Avatar de una persona: "Luis" → "L", "Ana Paula" → "AP".
  function initials(name) {
    const parts = words(name);
    if (parts.length === 0) return '?';
    return parts
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  // Ícono de un servidor, como en Discord: "Casa de Luis" → "CdL".
  function serverInitials(name) {
    const parts = words(name);
    if (parts.length === 0) return '?';
    return parts
      .slice(0, 3)
      .map((w) => w[0])
      .join('');
  }

  // Colores de avatar: pocos y apagados, para distinguir gente sin ruido.
  const AVATAR_COLORS = ['#C93D75', '#5865A8', '#3E8E7E', '#B7791F', '#7A5AA6', '#4F7CAC'];

  function colorFor(key) {
    let hash = 0;
    for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  // ─── Fechas ─────────────────────────────────────────────────────────────────

  const timeFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    );
  }

  function formatTime(iso) {
    return timeFormat.format(new Date(iso));
  }

  function formatDay(iso) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (sameDay(date, today)) return 'Hoy';
    if (sameDay(date, yesterday)) return 'Ayer';
    return dayFormat.format(date);
  }

  // "Hoy a las 14:05" / "Ayer a las 09:30" / "3 de octubre de 2026 14:05"
  function formatStamp(iso) {
    const day = formatDay(iso);
    const time = formatTime(iso);
    return day === 'Hoy' || day === 'Ayer' ? `${day} a las ${time}` : `${day} ${time}`;
  }

  // ─── Varios ─────────────────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  R.util = {
    h,
    append,
    clear,
    normalizeNickname,
    normalizeSlug,
    initials,
    serverInitials,
    colorFor,
    sameDay,
    formatTime,
    formatDay,
    formatStamp,
    debounce,
  };
})(window.Recop);
