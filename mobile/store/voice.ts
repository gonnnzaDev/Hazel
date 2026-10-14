/**
 * Voz: en qué canal estás, quién está en cada uno y quién habla.
 *
 * El audio lo maneja un `VoiceEngine` (api/voice.ts). Este store solo guarda
 * lo que la interfaz necesita mostrar.
 */

import { create } from 'zustand';

import { voiceEngine } from '@/api/voice';
import { initialVoiceStates } from '@/mocks/servers';
import { ME_ID } from '@/mocks/users';

interface VoiceState {
  /** Quién está en cada canal de voz (sin contar a la persona logueada). */
  rooms: Record<string, string[]>;
  connectedChannelId: string | null;
  connecting: boolean;
  joinedAt: number | null;
  muted: boolean;
  deafened: boolean;
  speaking: Record<string, boolean>;

  join(channelId: string): Promise<void>;
  leave(): void;
  toggleMute(): void;
  toggleDeafen(): void;
}

export const useVoice = create<VoiceState>()((set, get) => ({
  rooms: initialVoiceStates,
  connectedChannelId: null,
  connecting: false,
  joinedAt: null,
  muted: false,
  deafened: false,
  speaking: {},

  async join(channelId) {
    if (get().connectedChannelId === channelId) return;
    get().leave();
    set({ connectedChannelId: channelId, connecting: true, speaking: {} });
    await voiceEngine.join(channelId, ME_ID, get().rooms[channelId] ?? []);
    if (get().connectedChannelId !== channelId) return; // se fue mientras conectaba
    set({ connecting: false, joinedAt: Date.now() });
    voiceEngine.setMuted(get().muted);
  },

  leave() {
    if (!get().connectedChannelId) return;
    voiceEngine.leave();
    set({ connectedChannelId: null, connecting: false, joinedAt: null, speaking: {} });
  },

  toggleMute() {
    const { muted, deafened } = get();
    // Como en Discord: con los auriculares apagados, tocar el micrófono prende todo.
    const next = deafened ? false : !muted;
    set({ muted: next, deafened: deafened ? false : deafened });
    voiceEngine.setMuted(next);
  },

  toggleDeafen() {
    const deafened = !get().deafened;
    set({ deafened, muted: deafened ? true : get().muted });
    voiceEngine.setDeafened(deafened);
    voiceEngine.setMuted(deafened || get().muted);
  },
}));

voiceEngine.onSpeaking((userId, speaking) => {
  useVoice.setState((s) => ({ speaking: { ...s.speaking, [userId]: speaking } }));
});
