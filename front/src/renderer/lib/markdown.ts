/**
 * Markdown básico del chat, sin dependencias.
 *
 * Bloques: ```código```, > citas y párrafos.
 * En línea: **negrita**, *cursiva* o _cursiva_, ~~tachado~~, `código`,
 * @nickname (mención), :emoji: y links http(s).
 *
 * No hay anidado (no existe **negrita con *cursiva* adentro**): para un chat
 * alcanza, y el parser queda chico y predecible.
 */

import { emojis } from './emojis';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'mention'; nick: string }
  | { kind: 'link'; url: string };

export type Block =
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] };

// El orden importa: el código va primero para que nada adentro se interprete.
// `_cursiva_` no cuenta pegado a una palabra ni después de `\`: así
// `snake_case` y ¯\_(ツ)_/¯ quedan como están. Una mención es @ seguido de un
// nickname de Hazel (minúsculas, números, punto, guion y guion bajo), y no
// cuenta pegada a una palabra: un mail no es una mención.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*|(?<![\\\w])_[^_\n]+_(?!\w))|((?<![\w@])@[a-z0-9._-]{2,32})|(https?:\/\/[^\s<>]+)|(:[a-z0-9_+-]+:)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token, code, bold, strike, italic, mention, link, emoji] = match;
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });

    if (code) out.push({ kind: 'code', text: code.slice(1, -1) });
    else if (bold) out.push({ kind: 'bold', text: bold.slice(2, -2) });
    else if (strike) out.push({ kind: 'strike', text: strike.slice(2, -2) });
    else if (italic) out.push({ kind: 'italic', text: italic.slice(1, -1) });
    else if (mention) out.push({ kind: 'mention', nick: mention.slice(1).replace(/[.]+$/, '') });
    else if (link) out.push({ kind: 'link', url: link });
    else if (emoji) out.push({ kind: 'text', text: emojis[emoji.slice(1, -1)] ?? emoji });
    else out.push({ kind: 'text', text: token });

    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(content: string): Block[] {
  const blocks: Block[] = [];
  const parts = content.split(/```/);

  parts.forEach((part, i) => {
    // Las partes impares están entre ``` y ```: son código.
    if (i % 2 === 1) {
      const newline = part.indexOf('\n');
      const lang = newline > 0 ? part.slice(0, newline).trim() : '';
      const code = newline > 0 ? part.slice(newline + 1) : part;
      blocks.push({ kind: 'code', lang, code: code.replace(/\n$/, '') });
      return;
    }

    const lines = part.split('\n');
    let paragraph: string[] = [];
    const flush = () => {
      const text = paragraph.join('\n').trim();
      if (text) blocks.push({ kind: 'paragraph', inlines: parseInline(text) });
      paragraph = [];
    };

    for (const line of lines) {
      if (line.startsWith('> ')) {
        flush();
        blocks.push({ kind: 'quote', inlines: parseInline(line.slice(2)) });
      } else {
        paragraph.push(line);
      }
    }
    flush();
  });

  return blocks;
}

/** Los nicknames mencionados en un texto (sin el @). */
export function mentionsIn(content: string): string[] {
  const found = new Set<string>();
  for (const inline of parseMarkdown(content).flatMap((b) => (b.kind === 'code' ? [] : b.inlines))) {
    if (inline.kind === 'mention') found.add(inline.nick);
  }
  return [...found];
}

/** Texto plano para previsualizaciones (respuestas, menciones, notificaciones). */
export function plainText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '[código]')
    .replace(/:([a-z0-9_+-]+):/g, (whole, name: string) => emojis[name] ?? whole)
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
