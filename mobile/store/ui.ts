/**
 * Estado de la interfaz: paleta de comandos, bottom sheets, avisos y ajustes.
 * Solo los ajustes se guardan entre aperturas.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { uid } from '@/lib/id';

import { storage } from './storage';

/** Qué bottom sheet está abierto. */
export type SheetState =
  | { kind: 'profile'; userId: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'message'; messageId: string; channelId: string }
  | { kind: 'members'; serverId: string }
  | { kind: 'server-actions' }
  | { kind: 'status' }
  | { kind: 'settings' };

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error';
}

interface Settings {
  haptics: boolean;
  particles: boolean;
}

interface UiState {
  wofiOpen: boolean;
  sheet: SheetState | null;
  toasts: Toast[];
  settings: Settings;
  /** Mensaje al que se está respondiendo, por canal. */
  replyTo: Record<string, string | undefined>;

  openWofi(): void;
  closeWofi(): void;
  openSheet(sheet: SheetState): void;
  closeSheet(): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: string): void;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  setReplyTo(channelId: string, messageId: string | undefined): void;
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      wofiOpen: false,
      sheet: null,
      toasts: [],
      settings: { haptics: true, particles: true },
      replyTo: {},

      openWofi() {
        set({ wofiOpen: true, sheet: null });
      },
      closeWofi() {
        set({ wofiOpen: false });
      },
      openSheet(sheet) {
        set({ sheet, wofiOpen: false });
      },
      closeSheet() {
        set({ sheet: null });
      },
      toast(text, tone = 'info') {
        const id = uid('toast');
        set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-3) }));
        setTimeout(() => get().dismissToast(id), 2600);
      },
      dismissToast(id) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      setSetting(key, value) {
        set((s) => ({ settings: { ...s.settings, [key]: value } }));
      },
      setReplyTo(channelId, messageId) {
        set((s) => ({ replyTo: { ...s.replyTo, [channelId]: messageId } }));
      },
    }),
    {
      name: 'recop.ui',
      storage,
      partialize: (state) => ({ settings: state.settings }),
    },
  ),
);
