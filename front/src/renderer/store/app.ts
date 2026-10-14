// El estado de la app mientras corre: el nodo, los servidores en los que estás,
// qué pantalla se ve, la red y los diálogos. Nada de esto se guarda: se vuelve
// a pedir al nodo cada vez que la app arranca.

import { create } from 'zustand';

import type { CallParticipant, Member, NodeAddress, NodeInfo, Server } from '../lib/types';

export type View =
  | { kind: 'home' }
  | { kind: 'channel'; key: string; channelId: string }
  | { kind: 'dm'; key: string; peerId: string }
  | { kind: 'voice'; key: string; channelId: string };

export type NodeStatus = 'connecting' | 'online' | 'offline';

export interface BootLine {
  id: number;
  tag: 'INFO' | ' OK ' | 'WAIT' | 'FAIL' | 'WARN';
  text: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

export type Modal =
  | { kind: 'create' }
  | { kind: 'join'; address?: string }
  | { kind: 'enter'; serverId: string; serverName: string; baseUrl: string }
  | { kind: 'settings' }
  | { kind: 'status'; key?: string }
  | { kind: 'profile'; key: string; memberId: string }
  | { kind: 'confirm'; title: string; text: string; action: string; danger?: boolean; onConfirm: () => Promise<void> | void };

/** Hasta dónde se guarda la historia de latencia y CPU (una muestra cada 2 s). */
export const HISTORY = 30;

interface AppStore {
  boot: { lines: BootLine[]; done: boolean };
  node: { status: NodeStatus; info: NodeInfo | null; address: NodeAddress | null; servers: Server[]; error: string | null };
  /** Servidores en los que estás, por clave de sesión. */
  servers: Record<string, Server>;
  /** No se pudo llegar al servidor de esa sesión (su nodo está apagado o lejos). */
  unreachable: Record<string, string>;
  members: Record<string, Member[]>;
  /** Quién está en cada canal de voz, por sesión y canal. */
  voiceRooms: Record<string, Record<string, CallParticipant[]>>;
  view: View;
  /** Latencia al nodo de lo que estás mirando: la última y la historia. */
  latency: { target: string; ms: number | null; history: number[] };
  system: { cpu: number[]; cores: number; memUsed: number; memTotal: number; available: boolean };
  wofiOpen: boolean;
  mentionsOpen: boolean;
  modal: Modal | null;
  toasts: Toast[];
}

export const useApp = create<AppStore>()(() => ({
  boot: { lines: [], done: false },
  node: { status: 'connecting', info: null, address: null, servers: [], error: null },
  servers: {},
  unreachable: {},
  members: {},
  voiceRooms: {},
  view: { kind: 'home' },
  latency: { target: '', ms: null, history: [] },
  system: { cpu: [], cores: 0, memUsed: 0, memTotal: 0, available: false },
  wofiOpen: false,
  mentionsOpen: false,
  modal: null,
  toasts: [],
}));

let nextId = 1;

export function bootLine(tag: BootLine['tag'], text: string): number {
  const id = nextId++;
  useApp.setState((s) => ({ boot: { ...s.boot, lines: [...s.boot.lines, { id, tag, text }] } }));
  return id;
}

/** Cambia el resultado de una línea de arranque que estaba esperando. */
export function settleBootLine(id: number, tag: BootLine['tag'], text?: string): void {
  useApp.setState((s) => ({
    boot: {
      ...s.boot,
      lines: s.boot.lines.map((l) => (l.id === id ? { ...l, tag, text: text ?? l.text } : l)),
    },
  }));
}

export function toast(text: string, tone: Toast['tone'] = 'info'): void {
  const id = nextId++;
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  setTimeout(() => useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 3500);
}

export function openModal(modal: Modal): void {
  useApp.setState({ modal, wofiOpen: false, mentionsOpen: false });
}

export function closeModal(): void {
  useApp.setState({ modal: null });
}

export function pushHistory(history: number[], value: number): number[] {
  return [...history.slice(-(HISTORY - 1)), value];
}
