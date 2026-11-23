import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface Dependency {
  name: string;
  present: boolean;
  why: string;
  install: string;
}

/**
 * Solo en Tauri: comprueba qué falta para ejecutar cliente y nodo al 100%.
 * Un error NO se transforma en "todo instalado": el arranque debe detenerse.
 */
export async function checkDependencies(): Promise<Dependency[]> {
  if (!isTauri()) return [];
  return await invoke<Dependency[]>('check_dependencies');
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

/** Paso determinado de la barra (porcentaje + etiqueta). */
export interface InstallProgress {
  percent: number;
  label: string;
}

export async function onInstallProgressStep(
  onStep: (step: InstallProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const unlisten = await listen<InstallProgress>('deps-progress-step', (event) =>
    onStep(event.payload),
  );
  return unlisten;
}
