import { eventSchema, type HazelEvent } from './schema';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

type Handlers = {
  onEvent: (event: HazelEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
};

/** WebSocket de eventos con reconexión y heartbeat. */
export class HazelSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private attempts = 0;
  private stopped = true;
  private url = '';
  private readonly channels = new Set<string>();

  constructor(private readonly handlers: Handlers) {}

  connect(baseUrl: string, token: string) {
    const wsBase = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    this.url = `${wsBase}/api/v1/ws?token=${encodeURIComponent(token)}`;
    this.stopped = false;
    this.attempts = 0;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    this.channels.clear();
    this.clearTimers();
    this.ws?.close(1000, 'client disconnect');
    this.ws = null;
    this.handlers.onStatus('closed');
  }

  subscribe(channelId: string) {
    if (this.channels.has(channelId)) return;
    this.channels.add(channelId);
    this.send({ type: 'channel.subscribe', channel_id: channelId });
  }

  unsubscribe(channelId: string) {
    this.channels.delete(channelId);
    this.send({ type: 'channel.unsubscribe', channel_id: channelId });
  }

  typing(channelId: string) {
    this.send({ type: 'typing.start', channel_id: channelId });
  }

  private open() {
    if (this.stopped) return;
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus('open');
      for (const channelId of this.channels) {
        this.send({ type: 'channel.subscribe', channel_id: channelId });
      }
      this.heartbeatTimer = window.setInterval(() => {
        this.send({ type: 'heartbeat' });
      }, 30_000);
    };

    ws.onmessage = (message) => {
      if (typeof message.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = eventSchema.safeParse(raw);
      if (parsed.success) this.handlers.onEvent(parsed.data);
    };

    ws.onclose = () => {
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.stopped) return;
      this.attempts += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** (this.attempts - 1));
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    };

    ws.onerror = () => ws.close();
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private clearTimers() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }
}
