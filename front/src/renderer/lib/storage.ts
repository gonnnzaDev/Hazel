// localStorage sin sorpresas: si no hay lugar o el contenido está roto, la app
// sigue andando con el valor por defecto en vez de romperse al arrancar.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`no se pudo guardar ${key}:`, error);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nada que hacer
  }
}

/** Guarda como mucho una vez cada `ms`, con el último valor. */
export function debouncedSaver(ms: number): (key: string, value: () => unknown) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (key, value) => {
    const pending = timers.get(key);
    if (pending) clearTimeout(pending);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        save(key, value());
      }, ms),
    );
  };
}
