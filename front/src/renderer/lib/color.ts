// Colores que salen de un texto: siempre el mismo para el mismo servidor o la
// misma persona, en cualquier compu, sin guardarlo en ningún lado.

const ACCENTS = ['#00E5FF', '#A855F7', '#BFFF00', '#F27BA8', '#FFB020', '#4D9FFF'];
const AVATARS = ['#7C3AED', '#0891B2', '#16A34A', '#DB2777', '#EA580C', '#2563EB', '#CA8A04', '#9333EA'];

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

/** El color de acento de un servidor (borde, brillo y banner). */
export function accentOf(id: string): string {
  return ACCENTS[hash(id) % ACCENTS.length] ?? '#00E5FF';
}

/** El color de fondo del avatar de alguien. */
export function avatarColorOf(nickname: string): string {
  return AVATARS[hash(nickname) % AVATARS.length] ?? '#7C3AED';
}

/** Iniciales: "Casa de Luis" → "CdL", "ana_paula" → "AP". */
export function initials(name: string, max = 3): string {
  const words = name
    .replace(/[_.-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 1) return (words[0] ?? '?').slice(0, 2).toUpperCase();
  return words
    .slice(0, max)
    .map((w, i) => (i === 0 || w.length > 2 ? (w[0] ?? '').toUpperCase() : (w[0] ?? '')))
    .join('');
}

/** `#rrggbb` + transparencia (0 a 1) → `rgba(…)`. */
export function alpha(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
