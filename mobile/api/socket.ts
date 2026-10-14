/**
 * Capa de tiempo real.
 *
 * La app habla con UNA interfaz, `RealtimeSocket`, y no sabe qué hay detrás:
 *
 * - `MockSocket`: simula un servidor (gente que escribe, contesta, latencia
 *   que varía). Es el modo por defecto: la app funciona completa sin backend.
 * - `RecopSocket`: el WebSocket real de Recop (`WS /api/v1/ws?token=…`, ver
 *   docs/api.md §7). Se activa definiendo `EXPO_PUBLIC_RECOP_WS_URL`.
 *
 * Los stores no se enteran de cuál se usa: reciben `RealtimeEvent`s por
 * `subscribe` (ver hooks/useRealtime.ts).
 */

import type { Message, Presence } from './types';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

/** Lo que llega del servidor, ya traducido a tipos del dominio. */
export type RealtimeEvent =
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'latency'; ms: number }
  | { type: 'message.created'; message: Message }
  | { type: 'typing.start'; channelId: string; userId: string }
  | { type: 'typing.stop'; channelId: string; userId: string }
  | { type: 'presence.update'; userId: string; presence: Presence };

/** Lo que la app le manda al servidor. */
export type ClientEvent =
  | { type: 'heartbeat'; sentAt: number }
  | { type: 'channel.subscribe'; channelId: string }
  | { type: 'typing.start'; channelId: string }
  /** En el backend real enviar es un POST; el mock lo usa para simular respuestas. */
  | { type: 'message.sent'; message: Message };

export type RealtimeListener = (event: RealtimeEvent) => void;

export interface RealtimeSocket {
  readonly kind: 'mock' | 'recop';
  connect(): void;
  disconnect(): void;
  send(event: ClientEvent): void;
  /** Devuelve la función para desuscribirse. */
  subscribe(listener: RealtimeListener): () => void;
}

/** Lo que el mock necesita saber del "mundo" para inventar actividad creíble. */
export interface MockWorld {
  /** Canales donde puede aparecer actividad, con quiénes pueden escribir. */
  channels(): { channelId: string; authorIds: string[] }[];
  /** Personas que pueden contestar en un canal. */
  authorsFor(channelId: string): string[];
  cannedReplies: string[];
}

// ─── Base común ───────────────────────────────────────────────────────────────

abstract class BaseSocket implements RealtimeSocket {
  abstract readonly kind: 'mock' | 'recop';
  private readonly listeners = new Set<RealtimeListener>();

  abstract connect(): void;
  abstract disconnect(): void;
  abstract send(event: ClientEvent): void;

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(event: RealtimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)];
let mockSeq = 0;

export class MockSocket extends BaseSocket {
  readonly kind = 'mock' as const;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private latency = 28;
  private connected = false;

  constructor(private readonly world: MockWorld) {
    super();
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.emit({ type: 'status', status: 'connecting' });
    this.later(700, () => this.emit({ type: 'status', status: 'online' }));

    // Latencia: un paseo aleatorio entre 14 y 90 ms, con algún pico.
    this.intervals.push(
      setInterval(() => {
        const spike = Math.random() < 0.06 ? rand(60, 140) : 0;
        this.latency = Math.round(Math.min(90, Math.max(14, this.latency + rand(-6, 6))) + spike);
        this.emit({ type: 'latency', ms: this.latency });
      }, 2000),
    );

    // Actividad espontánea en algún canal cada tanto.
    this.intervals.push(setInterval(() => this.ambientActivity(), 15_000));
  }

  disconnect(): void {
    this.connected = false;
    for (const t of this.timers) clearTimeout(t);
    for (const i of this.intervals) clearInterval(i);
    this.timers = [];
    this.intervals = [];
    this.emit({ type: 'status', status: 'offline' });
  }

  send(event: ClientEvent): void {
    if (event.type === 'message.sent' && !event.message.system) {
      // Más de la mitad de las veces alguien del canal contesta.
      if (Math.random() < 0.65) this.replyTo(event.message);
    }
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private typeAndSay(channelId: string, authorId: string, content: string, extra: Partial<Message> = {}): void {
    this.emit({ type: 'typing.start', channelId, userId: authorId });
    this.later(rand(1800, 3600), () => {
      this.emit({ type: 'typing.stop', channelId, userId: authorId });
      mockSeq += 1;
      this.emit({
        type: 'message.created',
        message: {
          id: `mock-${Date.now()}-${mockSeq}`,
          channelId,
          authorId,
          content,
          createdAt: Date.now(),
          reactions: [],
          mentions: [...content.matchAll(/<@([\w-]+)>/g)].map((m) => m[1] ?? ''),
          ...extra,
        },
      });
    });
  }

  private replyTo(message: Message): void {
    const authors = this.world.authorsFor(message.channelId).filter((id) => id !== message.authorId);
    const author = pick(authors);
    const content = pick(this.world.cannedReplies);
    if (!author || !content) return;
    this.later(rand(800, 1600), () =>
      this.typeAndSay(message.channelId, author, content, Math.random() < 0.4 ? { replyToId: message.id } : {}),
    );
  }

  private ambientActivity(): void {
    const target = pick(this.world.channels());
    if (!target) return;
    const author = pick(target.authorIds);
    const content = pick(this.world.cannedReplies);
    if (author && content) this.typeAndSay(target.channelId, author, content);
  }
}

// ─── Recop real ───────────────────────────────────────────────────────────────

/** El formato de evento que define docs/api.md §7. */
interface RecopWireEvent {
  type: string;
  server_id?: string;
  channel_id?: string;
  data?: Record<string, unknown>;
}

/**
 * Adaptador al WebSocket de Recop. El backend todavía no lo implementa
 * (`[ ]` en docs/api.md), así que esto sigue el contrato documentado:
 *
 *   servidor → cliente: { type: 'message.created' | 'typing.start' | 'presence.update' | …, channel_id, data }
 *   cliente → servidor: { type: 'heartbeat' | 'typing.start' | 'channel.subscribe', channel_id? }
 *
 * Reconecta solo con espera exponencial y mide la latencia con el heartbeat.
 */
export class RecopSocket extends BaseSocket {
  readonly kind = 'recop' as const;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private closedOnPurpose = false;

  constructor(
    private readonly url: string,
    private readonly token: () => string | null,
  ) {
    super();
  }

  connect(): void {
    this.closedOnPurpose = false;
    const token = this.token();
    const url = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;
    this.emit({ type: 'status', status: this.attempts ? 'reconnecting' : 'connecting' });

    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.emit({ type: 'status', status: 'online' });
      this.heartbeat = setInterval(() => this.send({ type: 'heartbeat', sentAt: Date.now() }), 15_000);
    };
    ws.onmessage = (event: MessageEvent<string>) => this.handle(event.data);
    ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.closedOnPurpose) return;
      this.attempts += 1;
      this.emit({ type: 'status', status: 'reconnecting' });
      setTimeout(() => this.connect(), Math.min(30_000, 1000 * 2 ** this.attempts));
    };
  }

  disconnect(): void {
    this.closedOnPurpose = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    this.ws = null;
    this.emit({ type: 'status', status: 'offline' });
  }

  send(event: ClientEvent): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (event.type === 'heartbeat') {
      this.lastHeartbeatAt = event.sentAt;
      this.ws.send(JSON.stringify({ type: 'heartbeat' }));
    } else if (event.type === 'typing.start' || event.type === 'channel.subscribe') {
      this.ws.send(JSON.stringify({ type: event.type, channel_id: event.channelId }));
    }
    // 'message.sent' no viaja por el socket: en Recop enviar es un POST (api/client.ts).
  }

  private handle(raw: string): void {
    let event: RecopWireEvent;
    try {
      event = JSON.parse(raw) as RecopWireEvent;
    } catch {
      return; // el contrato pide ignorar lo que no se entiende
    }
    const channelId = event.channel_id ?? '';
    const data = event.data ?? {};

    switch (event.type) {
      case 'heartbeat.ack':
        if (this.lastHeartbeatAt) this.emit({ type: 'latency', ms: Date.now() - this.lastHeartbeatAt });
        break;
      case 'message.created':
        this.emit({
          type: 'message.created',
          message: {
            id: String(data['id'] ?? ''),
            channelId,
            // Recop identifica por nickname dentro del servidor.
            authorId: String(data['author_nickname'] ?? ''),
            content: String(data['content'] ?? ''),
            createdAt: Date.parse(String(data['created_at'] ?? '')) || Date.now(),
            reactions: [],
            mentions: [],
          },
        });
        break;
      case 'typing.start':
        this.emit({ type: 'typing.start', channelId, userId: String(data['nickname'] ?? '') });
        break;
      case 'presence.update':
        this.emit({
          type: 'presence.update',
          userId: String(data['nickname'] ?? ''),
          presence: data['is_online'] ? 'online' : 'offline',
        });
        break;
      default:
        break; // eventos nuevos o desconocidos: se ignoran
    }
  }
}

// ─── Fábrica ──────────────────────────────────────────────────────────────────

let instance: RealtimeSocket | null = null;

/**
 * El socket de la app. Con `EXPO_PUBLIC_RECOP_WS_URL` definida usa el
 * backend real; si no, el mock.
 */
export function getSocket(world: MockWorld, token: () => string | null): RealtimeSocket {
  if (!instance) {
    const url = process.env.EXPO_PUBLIC_RECOP_WS_URL;
    instance = url ? new RecopSocket(url, token) : new MockSocket(world);
  }
  return instance;
}
