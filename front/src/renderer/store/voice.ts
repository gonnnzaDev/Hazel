// La llamada de voz en curso (hay una sola a la vez, como en Discord).

import { create } from 'zustand';

import type { CallParticipant } from '../lib/types';

/** Cuántas barras tiene la onda de cada persona. */
export const WAVE_BARS = 16;

export interface CallInfo {
  key: string;
  channelId: string;
  channelName: string;
  serverName: string;
  state: 'connecting' | 'connected';
  joinedAt: number;
  selfId: string | null;
  muted: boolean;
  deafened: boolean;
  /** Incluye a esta app. */
  participants: CallParticipant[];
  speaking: Record<string, boolean>;
  /** Los últimos niveles de audio de cada persona, de 0 a 1 (la onda). */
  levels: Record<string, number[]>;
  /** Ida y vuelta con cada persona, en ms. */
  rtt: Record<string, number | null>;
}

export const useVoice = create<{ call: CallInfo | null }>()(() => ({ call: null }));

export function patchCall(patch: Partial<CallInfo>): void {
  const { call } = useVoice.getState();
  if (call) useVoice.setState({ call: { ...call, ...patch } });
}
