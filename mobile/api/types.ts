/**
 * Tipos del dominio. Son los que usa toda la app; la capa de red (api/) se
 * encarga de traducir lo que venga del backend a estas formas.
 */

export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

/** "Rich Presence": qué está haciendo alguien ahora. */
export interface Activity {
  kind: 'playing' | 'listening' | 'coding' | 'watching';
  name: string;
  details?: string;
  /** Epoch en ms. */
  startedAt: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  /** Color de fondo del avatar cuando no hay imagen. */
  avatarColor: string;
  /** Emoji opcional en vez de las iniciales. */
  avatarEmoji?: string;
  banner: [string, string];
  presence: Presence;
  customStatus?: string;
  activity?: Activity;
  bio?: string;
  bot?: boolean;
}

export interface Role {
  id: string;
  name: string;
  color: string;
  /** Ícono de Feather para el badge, si el rol tiene uno. */
  badge?: 'shield' | 'star' | 'zap' | 'cpu' | 'code';
  /** Más alto, más importante. */
  position: number;
}

export interface Member {
  userId: string;
  roleIds: string[];
}

export type ChannelType = 'text' | 'voice' | 'announcement';

export interface Category {
  id: string;
  name: string;
}

export interface Channel {
  id: string;
  serverId: string;
  categoryId: string;
  name: string;
  type: ChannelType;
  topic?: string;
}

export interface Server {
  id: string;
  name: string;
  /** Emoji o texto corto para el ícono del dock. */
  icon: string;
  accent: string;
  banner: [string, string];
  description: string;
  inviteCode: string;
  ownerId: string;
  categories: Category[];
  channels: Channel[];
  roles: Role[];
  members: Member[];
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  /** Canal, hilo o DM al que pertenece. */
  channelId: string;
  authorId: string;
  content: string;
  /** Epoch en ms. */
  createdAt: number;
  editedAt?: number;
  replyToId?: string;
  /** Si el mensaje abrió un hilo, su id. */
  threadId?: string;
  reactions: Reaction[];
  /** Ids de las personas mencionadas con @. */
  mentions: string[];
  /** Mientras se envía. */
  pending?: boolean;
  /** Mensajes del sistema (/ping, /help…), sin autor real. */
  system?: boolean;
}

export interface Thread {
  id: string;
  /** Canal donde está el mensaje que abrió el hilo. */
  channelId: string;
  parentMessageId: string;
  name: string;
}

export interface DirectChannel {
  id: string;
  userId: string;
}

export interface FriendRequest {
  id: string;
  userId: string;
  direction: 'incoming' | 'outgoing';
}

export interface VoiceParticipant {
  userId: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}
