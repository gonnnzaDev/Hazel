import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface Dependency {
  name: string;
  present: boolean;
  why: string;
  install: string;
}

/** Solo en Tauri: comprueba qué falta para ejecutar cliente y nodo al 100%. */
export async function checkDependencies(): Promise<Dependency[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<Dependency[]>('check_dependencies');
  } catch {
    return [];
  }
}

/** Lanza el instalador elevado. El usuario no ejecuta ni copia nada. */
export async function installDependencies(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('install_dependencies');
}

/** Progreso del instalador, emitido desde Rust. */
export async function onInstallProgress(onLine: (line: string) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const unlisten = await listen<string>('deps-progress', (event) => onLine(event.payload));
  return unlisten;
}
