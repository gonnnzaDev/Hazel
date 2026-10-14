// El estado en memoria de la app. Lo que tiene que sobrevivir a cerrarla vive
// en store.ts; esto se arma de nuevo cada vez a partir del backend.

import type { VoiceCall } from './call';
import type { CallParticipant, Member, Message, NodeAddress, NodeInfo, Server } from './types';

/** Un mensaje en pantalla. `pending` mientras se envía. */
export interface ChatMessage extends Message {
  pending?: boolean;
}

export interface Thread {
  items: ChatMessage[];
  total: number;
  loaded: boolean;
  loadingOlder: boolean;
}

/** Lo que se sabe de un servidor abierto. */
export interface ServerState {
  detail: Server | null;
  members: Member[];
  channelId: string | null;
  /** Por canal. */
  messages: Record<string, Thread>;
  /** Quién está en cada canal de voz, por canal. */
  voice: Record<string, CallParticipant[]>;
  reachable: boolean;
  sessionExpired: boolean;
  gone: boolean;
  /** Autores que escribieron y la lista de miembros todavía no conocía. */
  unknownAuthors: string;
}

export type BusyKind = 'start' | 'stop' | 'delete';

export interface NodeState {
  status: 'loading' | 'online' | 'offline';
  info: NodeInfo | null;
  address: NodeAddress | null;
  servers: Server[];
  /** Servidores con una operación en curso, por id. */
  busy: Record<string, BusyKind>;
}

export interface AppState {
  view: 'home' | 'server';
  sessionKey: string | null;
  showMembers: boolean;
  /** Lo escrito y no enviado, por `sesión|canal`. */
  drafts: Record<string, string>;
  node: NodeState;
  /** Por clave de sesión. */
  servers: Record<string, ServerState>;
  call: VoiceCall | null;
}

export function emptyNode(): NodeState {
  return { status: 'loading', info: null, address: null, servers: [], busy: {} };
}

export const state: AppState = {
  view: 'home',
  sessionKey: null,
  showMembers: true,
  drafts: {},
  node: emptyNode(),
  servers: {},
  call: null,
};

export function serverStateFor(key: string): ServerState {
  let ss = state.servers[key];
  if (!ss) {
    ss = {
      detail: null,
      members: [],
      channelId: null,
      messages: {},
      voice: {},
      reachable: true,
      sessionExpired: false,
      gone: false,
      unknownAuthors: '',
    };
    state.servers[key] = ss;
  }
  return ss;
}
