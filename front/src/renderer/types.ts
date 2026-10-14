// Tipos del contrato de la API (`/api/v1`) y de lo que el cliente guarda.
//
// Los de la API copian los schemas de Pydantic del backend
// (`apps/*/schemas.py`). Si un schema cambia allá, se cambia acá.

// ─── API ──────────────────────────────────────────────────────────────────────

export type ServerStatus = 'creating' | 'active' | 'inactive' | 'deleted';
export type ChannelKind = 'text' | 'voice';
export type Role = 'owner' | 'admin' | 'member';

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  kind: ChannelKind;
  topic: string | null;
  position: number;
  is_default: boolean;
}

export interface Server {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ServerStatus;
  bind_port: number;
  max_members: number;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  channels: Channel[];
}

export interface ChannelCreate {
  name: string;
  kind: ChannelKind;
  position: number;
  is_default?: boolean;
}

export interface ServerCreate {
  name: string;
  slug: string;
  owner_nickname: string;
  channels: ChannelCreate[];
}

export interface Member {
  id: string;
  nickname: string;
  display_name: string;
  role: Role;
  is_online: boolean;
  last_seen_at: string | null;
  joined_at: string;
}

export interface ServerSummary {
  id: string;
  slug: string;
  name: string;
}

export interface JoinRequest {
  nickname: string;
  display_name?: string;
}

export interface JoinResponse {
  token: string;
  expires_at: string | null;
  member: Member;
  server: ServerSummary;
}

export interface MeResponse {
  member: Member;
  server: ServerSummary;
}

export interface Message {
  id: string;
  author_nickname: string;
  content: string;
  created_at: string;
}

export interface NodeInfo {
  service: string;
  version: string;
  environment: string;
  bind_host: string;
  bind_port: number;
  is_listening: boolean;
}

export interface LocalAddress {
  host: string;
  family: 'ipv4' | 'ipv6';
  private: boolean;
  loopback: boolean;
}

export interface NodeAddress {
  port: number;
  bind_host: string;
  is_wildcard: boolean;
  candidates: LocalAddress[];
  recommended: string | null;
}

export interface CallParticipant {
  member_id: string;
  nickname: string;
  display_name: string;
  mic: boolean;
  cam: boolean;
}

export interface CallParticipants {
  channel_id: string;
  participants: CallParticipant[];
  count: number;
  max: number;
}

// ─── Cliente ──────────────────────────────────────────────────────────────────

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  nodeUrl: string;
  theme: Theme;
  lastNickname: string;
  /** 'home' o la clave de la última sesión abierta. */
  lastView?: string;
}

// En Recop no hay cuenta global: cada servidor al que entrás te da un token
// propio. Una sesión es eso: dónde está el servidor, con qué nickname entraste
// y el token.
export interface Session {
  key: string;
  baseUrl: string;
  serverId: string;
  name: string;
  slug: string;
  token: string;
  expiresAt: string | null;
  member: Member;
  lastChannelId: string | null;
}
