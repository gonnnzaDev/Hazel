/** Estado de la conexión: lo que muestran el Waybar y el monitor de red. */

import { create } from 'zustand';

import type { ConnectionStatus } from '@/api/socket';

const HISTORY = 24;

interface NetState {
  status: ConnectionStatus;
  latency: number | null;
  /** Últimas mediciones, de la más vieja a la más nueva. */
  history: number[];
  setStatus(status: ConnectionStatus): void;
  pushLatency(ms: number): void;
}

export const useNet = create<NetState>()((set) => ({
  status: 'offline',
  latency: null,
  history: [],
  setStatus(status) {
    set({ status });
  },
  pushLatency(ms) {
    set((s) => ({ latency: ms, history: [...s.history, ms].slice(-HISTORY) }));
  },
}));
