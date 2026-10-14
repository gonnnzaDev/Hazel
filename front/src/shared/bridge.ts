// El contrato entre la ventana y el proceso principal.
//
// La ventana corre aislada (sin Node). Por el puente pasan exactamente tres
// cosas: peticiones HTTP a un nodo, texto para el portapapeles y el uso de CPU
// y memoria de la máquina (para los widgets). Este archivo lo usan los dos
// lados, así que un cambio acá rompe la compilación de ambos en vez de fallar
// en runtime.

export const IPC = {
  request: 'api:request',
  copy: 'clipboard:write',
  stats: 'system:stats',
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

/** Uso real de la máquina, medido por el proceso principal. */
export interface SystemStats {
  /** Uso de CPU de toda la máquina desde la medición anterior, de 0 a 1. */
  cpu: number;
  cores: number;
  memUsed: number;
  memTotal: number;
}

export interface HazelBridge {
  request(request: ProxyRequest): Promise<ProxyResponse>;
  copy(text: string): Promise<void>;
  stats(): Promise<SystemStats>;
  platform: string;
  versions: { electron: string; chrome: string; node: string };
}
