import { invoke, isTauri } from '@tauri-apps/api/core';

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
