/** Espejo de las reglas del backend para no enviar bodies que serán rechazados. */

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function stripAccents(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeSlug(raw: string): string {
  return stripAccents(raw.trim().toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeNickname(raw: string): string {
  return stripAccents(raw.trim().toLowerCase())
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
}

/** Devuelve el mensaje del primer campo inválido, o null si todo está bien. */
export function validateCreateServer(fields: {
  name: string;
  slug: string;
  description: string;
  ownerName: string;
}): string | null {
  const name = fields.name.trim();
  if (byteLength(name) < 2 || byteLength(name) > 64) {
    return 'El nombre debe tener entre 2 y 64 caracteres.';
  }
  if (byteLength(fields.description.trim()) > 1000) {
    return 'La descripción no puede superar los 1000 caracteres.';
  }
  const slug = normalizeSlug(fields.slug);
  if (slug.length < 2 || slug.length > 64) {
    return 'El identificador debe tener entre 2 y 64 caracteres.';
  }
  const nickname = normalizeNickname(fields.ownerName);
  if (nickname.length < 2 || nickname.length > 32) {
    return 'El apodo debe tener entre 2 y 32 caracteres.';
  }
  if (!/^[a-z0-9]/.test(nickname) || !/^[a-z0-9._-]+$/.test(nickname)) {
    return 'El apodo solo admite letras, números, punto, guion y guion bajo.';
  }
  return null;
}
