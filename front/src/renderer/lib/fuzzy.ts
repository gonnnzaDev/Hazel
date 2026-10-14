/**
 * Búsqueda difusa para la paleta de comandos (estilo Wofi/Rofi): las letras
 * de la búsqueda tienen que aparecer en orden, no necesariamente juntas.
 * "gnrl" encuentra "general". Puntúa mejor el prefijo y las letras seguidas.
 */

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Puntaje de coincidencia, o `null` si no coincide. Más alto es mejor. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query.trim());
  if (!q) return 0;
  const t = normalize(text);

  if (t.startsWith(q)) return 1000 - t.length;
  const substring = t.indexOf(q);
  if (substring >= 0) return 600 - substring;

  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (found - ti);
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 30): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
