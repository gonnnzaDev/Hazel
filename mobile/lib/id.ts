let counter = 0;

/** Id único local (mensajes enviados, servidores creados, hilos…). */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
