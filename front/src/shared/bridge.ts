// El contrato entre la ventana y el proceso principal.
//
// La ventana corre aislada (sin Node). Por el puente pasan exactamente dos
// cosas: peticiones HTTP a un nodo y texto para el portapapeles. Este archivo
// lo usan los dos lados, así que un cambio acá rompe la compilación de ambos
// en vez de fallar en runtime.

export const IPC = {
  request: 'api:request',
  copy: 'clipboard:write',
} as const;

export interface ProxyRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export type ProxyFailure = 'invalid_url' | 'timeout' | 'network';

// Nunca es un error de JavaScript: un 4xx o una caída de red llegan como datos
// y la ventana decide qué hacer.
export interface ProxyResponse {
  ok: boolean;
  status: number;
  body?: string;
  error?: ProxyFailure;
}

export interface RecopBridge {
  request(request: ProxyRequest): Promise<ProxyResponse>;
  copy(text: string): Promise<void>;
  platform: string;
}
