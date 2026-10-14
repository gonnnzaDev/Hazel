// Utilidades sin estado: construir DOM, formatear fechas y normalizar nombres.

// ─── DOM ──────────────────────────────────────────────────────────────────────

export type Child = Node | string | number | null | undefined | false | readonly Child[];

type Handler<E extends Event> = (event: E) => void;

export interface Props {
  class?: string;
  /** Solo para íconos propios, nunca para texto de usuario. */
  html?: string;
  dataset?: Record<string, string> | null;
  style?: Partial<CSSStyleDeclaration>;
  onclick?: Handler<MouseEvent>;
  onmousedown?: Handler<MouseEvent>;
  oninput?: Handler<Event>;
  onchange?: Handler<Event>;
  onkeydown?: Handler<KeyboardEvent>;
  onsubmit?: Handler<SubmitEvent>;
  [attribute: string]: unknown;
}

// h('button', { class: 'btn', onclick: fn }, 'Texto', otroNodo)
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    // Por CSSOM y no por atributo: la CSP de la ventana bloquea `style="…"`.
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, ...children);
  return el;
}

// Como `Element.append`, pero acepta arreglos anidados y descarta null/false.
export function append<E extends Element>(el: E, ...children: Child[]): E {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, ...(child as readonly Child[]));
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear<E extends Element>(el: E): E {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// getElementById que falla fuerte: los contenedores de index.html siempre están.
export function byId<E extends HTMLElement = HTMLElement>(id: string): E {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el as E;
}

// ─── Nombres ──────────────────────────────────────────────────────────────────

function stripAccents(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Igual que `apps/common/nickname.py::normalize`: "  José  Luis " → "jose_luis".
export function normalizeNickname(raw: string): string {
  return stripAccents(raw.trim().toLowerCase())
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
}

// Igual que `apps/servers/services.py::normalize_slug`: "Casa de Luis" → "casa-de-luis".
export function normalizeSlug(raw: string): string {
  return stripAccents(raw.trim().toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

// Avatar de una persona: "Luis" → "L", "Ana Paula" → "AP".
export function initials(name: string): string {
  const parts = words(name);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase();
}

// Ícono de un servidor, como en Discord: "Casa de Luis" → "CdL".
export function serverInitials(name: string): string {
  const parts = words(name);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 3)
    .map((w) => w.charAt(0))
    .join('');
}

// Colores de avatar: pocos y apagados, para distinguir gente sin ruido.
const AVATAR_COLORS = ['#C93D75', '#5865A8', '#3E8E7E', '#B7791F', '#7A5AA6', '#4F7CAC'] as const;

export function colorFor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

// ─── Fechas ───────────────────────────────────────────────────────────────────

const timeFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Hoy';
  if (sameDay(date, yesterday)) return 'Ayer';
  return dayFormat.format(date);
}

// "Hoy a las 14:05" / "Ayer a las 09:30" / "3 de octubre de 2026 14:05"
export function formatStamp(iso: string): string {
  const day = formatDay(iso);
  const time = formatTime(iso);
  return day === 'Hoy' || day === 'Ayer' ? `${day} a las ${time}` : `${day} ${time}`;
}

// ─── Errores ──────────────────────────────────────────────────────────────────

// Lo que se muestra de un error cualquiera. En un `catch` el error es
// `unknown`: puede ser cualquier cosa, no solo un `Error`.
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Algo salió mal.';
}
