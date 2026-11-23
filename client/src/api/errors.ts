import { problemSchema } from './schema';

/** Error de dominio mapeado desde application/problem+json. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly problem: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function readError(response: Response): Promise<ApiError> {
  const text = await response.text();
  try {
    const problem = problemSchema.parse(JSON.parse(text));
    const message =
      problem.detail ??
      problem.title ??
      `Error ${response.status}`;
    return new ApiError(
      problem.status ?? response.status,
      problem.code ?? `http_${response.status}`,
      message,
      problem,
    );
  } catch {
    return new ApiError(
      response.status,
      `http_${response.status}`,
      text || response.statusText || 'Error de red',
    );
  }
}

const FIELD_NAMES: Record<string, string> = {
  name: 'nombre',
  slug: 'identificador',
  description: 'descripción',
  max_members: 'número máximo de miembros',
  display_name: 'nombre visible',
  nickname: 'apodo',
  content: 'mensaje',
  ttl_seconds: 'duración de la invitación',
};

function validationFields(problem: Record<string, unknown>): string[] {
  const raw = problem.errors;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { errors?: unknown }).errors)
      ? (raw as { errors: unknown[] }).errors
      : [];
  const fields: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const loc = (item as { loc?: unknown }).loc;
    if (Array.isArray(loc)) {
      const key = loc[loc.length - 1];
      if (typeof key === 'string') fields.push(FIELD_NAMES[key] ?? key);
    } else {
      const msg = (item as { msg?: unknown }).msg;
      if (typeof msg === 'string') fields.push(msg);
    }
  }
  return [...new Set(fields)];
}

const FRIENDLY: Record<string, string> = {
  invalid_token: 'Tu sesión expiró. Vuelve a unirte.',
  unauthenticated: 'Necesitas unirte con un apodo primero.',
  wrong_server: 'Este token pertenece a otro servidor.',
  server_inactive: 'El servidor está apagado. Pídele a su dueño que lo active.',
  server_deleted: 'Este servidor ya no existe.',
  nickname_taken: 'Ese apodo ya está en uso en este servidor.',
  nickname_reserved: 'Ese apodo está reservado, elige otro.',
  nickname_invalid_charset: 'El apodo solo admite letras, números, punto, guion y guion bajo.',
  nickname_too_short: 'El apodo es demasiado corto (mínimo 2 caracteres).',
  nickname_too_long: 'El apodo es demasiado largo (máximo 32 caracteres).',
  channel_not_found: 'Ese canal no existe.',
  message_not_found: 'Ese mensaje no existe.',
  message_too_large: 'El mensaje supera los 4000 bytes.',
  rate_limited: 'Estás escribiendo demasiado rápido. Espera un momento.',
  not_admin: 'Necesitas permisos de administrador.',
  host_required: 'Solo la máquina anfitriona del nodo puede gestionar el servidor.',
  not_message_author: 'Solo el autor puede editar ese mensaje.',
  connection_error: 'No se pudo conectar con el nodo. Revisa la dirección.',
};

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'request_validation_error') {
      const fields = validationFields(error.problem);
      if (fields.length > 0) return `Revisa ${fields.join(', ')}.`;
    }
    return FRIENDLY[error.code] ?? error.message;
  }
  if (error instanceof TypeError) {
    return FRIENDLY.connection_error!;
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}
