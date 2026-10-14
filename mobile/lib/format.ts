/** Formatos de fecha y hora del chat, en castellano. */

const pad = (n: number) => String(n).padStart(2, '0');

export function clock(date: Date, withSeconds = false): string {
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "Hoy", "Ayer" o "12 oct". */
export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Hoy';
  if (sameDay(date, yesterday)) return 'Ayer';
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}

/** "hoy 14:05", "ayer 09:30" o "12 oct 14:05". */
export function stamp(timestamp: number): string {
  const day = dayLabel(timestamp);
  return `${day === 'Hoy' || day === 'Ayer' ? day.toLowerCase() : day} ${clock(new Date(timestamp))}`;
}

export function isSameDay(a: number, b: number): boolean {
  return sameDay(new Date(a), new Date(b));
}

/** "hace 5 min", "hace 2 h", "hace 3 d". */
export function relative(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/** Duración de una llamada o actividad: "04:12" o "1:04:12". */
export function duration(fromTimestamp: number, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - fromTimestamp) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
