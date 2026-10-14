// Lo que la ventana tiene en `window` además de lo del navegador.

import type { HazelBridge } from '../shared/bridge';
import type { AppState } from './state';
import type * as store from './store';

declare global {
  interface Window {
    /** El puente con el proceso principal. No está si la app corre en un navegador. */
    hazelBridge?: HazelBridge;
    /** Para depurar desde las herramientas de desarrollo. */
    Hazel?: { state: AppState; store: typeof store };
  }
}

export {};
