// Lo que la ventana tiene en `window` además de lo del navegador.

import type { RecopBridge } from '../shared/bridge';
import type { AppState } from './state';
import type * as store from './store';

declare global {
  interface Window {
    /** El puente con el proceso principal. No está si la app corre en un navegador. */
    recopBridge?: RecopBridge;
    /** Para depurar desde las herramientas de desarrollo. */
    Recop?: { state: AppState; store: typeof store };
  }
}

export {};
