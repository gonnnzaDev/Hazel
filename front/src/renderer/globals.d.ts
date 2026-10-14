// Lo que la ventana tiene en `window` además de lo del navegador.

<<<<<<< HEAD
import type { HazelBridge } from '../shared/bridge';
import type { AppState } from './state';
import type * as store from './store';
=======
import type { HazelBridge } from '../shared/bridge';
>>>>>>> pr-19

declare global {
  interface Window {
    /** El puente con el proceso principal. No está si la app corre en un navegador. */
<<<<<<< HEAD
    hazelBridge?: HazelBridge;
    /** Para depurar desde las herramientas de desarrollo. */
    Hazel?: { state: AppState; store: typeof store };
=======
    hazelBridge?: HazelBridge;
>>>>>>> pr-19
  }
}

export {};
