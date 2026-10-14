// Una sala de pares: WebRTC entre todos, con el nodo como presentador.
//
// Usa el WebSocket de llamadas del backend
// (`/servers/{id}/channels/{id}/call`, ver apps/servers/api/calls.py). El nodo
// no transporta nada: solo presenta a los participantes y les pasa las
// ofertas, respuestas y candidatos ICE. Lo demás va directo de una compu a la
// otra (full-mesh: cada uno conecta con todos).
//
// La usan dos cosas:
// - la voz (net/voice.ts): con el micrófono como pista de audio;
// - el chat (net/bus.ts): con un canal de datos, sin audio.
//
// Quien entra le ofrece conexión a los que ya estaban; los que ya estaban
// esperan esa oferta. Así nunca hay dos ofertas cruzadas para el mismo par.

import type { CallParticipant } from '../lib/types';

// Lo que manda el servidor por el socket.
type ServerSignal =
  | { type: 'welcome'; you: string; peers?: CallParticipant[]; ice_servers?: string[] }
  | { type: 'peer-joined'; peer: CallParticipant }
  | { type: 'peer-left'; member_id: string }
  | { type: 'peer-state'; member_id: string; mic: boolean; cam: boolean }
  | { type: 'offer' | 'answer'; from: string; payload: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; payload: RTCIceCandidateInit | null };

// Lo que el cliente le manda al servidor.
type ClientSignal =
  | { type: 'offer' | 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'state'; mic: boolean; cam: boolean };

/** Motivos de cierre que manda el servidor, en castellano. */
export const CLOSE_REASONS: Record<string, string> = {
  missing_token: 'Falta tu sesión en este servidor.',
  invalid_token: 'Tu sesión venció. Volvé a entrar al servidor.',
  expired_token: 'Tu sesión venció. Volvé a entrar al servidor.',
  wrong_server: 'Tu sesión es de otro servidor.',
  channel_not_found: 'Ese canal ya no existe.',
  server_not_found: 'El servidor ya no existe.',
  call_target_not_found: 'Ese canal ya no existe.',
};

/** Códigos de cierre que significan "tu sesión no sirve más". */
export const AUTH_CLOSE_CODES = new Set(['missing_token', 'invalid_token', 'expired_token', 'wrong_server']);

export class MeshError extends Error {
  readonly code: string;

  constructor(message: string, code = '') {
    super(message);
    this.name = 'MeshError';
    this.code = code;
  }
}

export interface MeshHandlers {
  welcome?(selfId: string, peers: CallParticipant[]): void;
  peerJoined?(peer: CallParticipant): void;
  peerLeft?(memberId: string): void;
  peerState?(memberId: string, mic: boolean): void;
  /** Se abrió el canal de datos con alguien: ya se le puede escribir. */
  open?(memberId: string): void;
  message?(memberId: string, data: unknown): void;
  track?(memberId: string, stream: MediaStream): void;
  /** El socket se cerró después de entrar. `code` es el motivo del servidor, si lo mandó. */
  closed?(reason: string, code: string): void;
}

export interface MeshOptions {
  url: string;
  /** Pistas que se mandan a cada par (el micrófono, en la voz). */
  stream?: MediaStream | null;
  /** Abrir un canal de datos con cada par (el chat). */
  data?: boolean;
  handlers: MeshHandlers;
}

const DATA_LABEL = 'hazel';
// Si la conexión con alguien falla, la reintenta uno solo de los dos (el de id
// mayor), así no se cruzan dos ofertas.
const RETRY_DELAY_MS = 1500;

export class PeerMesh {
  selfId: string | null = null;
  readonly peers = new Map<string, CallParticipant>();

  private readonly url: string;
  private readonly stream: MediaStream | null;
  private readonly data: boolean;
  private readonly handlers: MeshHandlers;

  private ws: WebSocket | null = null;
  private iceServers: RTCIceServer[] = [];
  private readonly connections = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  /** Candidatos que llegaron antes que la oferta de ese par. */
  private readonly pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  /** Los mensajes del socket se procesan de a uno, en orden. */
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: MeshOptions) {
    this.url = options.url;
    this.stream = options.stream ?? null;
    this.data = Boolean(options.data);
    this.handlers = options.handlers;
  }

  /** Entra a la sala. Resuelve con la bienvenida; falla si el servidor no deja entrar. */
  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let welcomed = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch {
        reject(new MeshError('La dirección del servidor no es válida.'));
        return;
      }
      this.ws = ws;

      ws.onmessage = (event: MessageEvent<string>) => {
        let message: ServerSignal;
        try {
          message = JSON.parse(event.data) as ServerSignal;
        } catch {
          return;
        }
        if (message.type === 'welcome' && !welcomed) {
          welcomed = true;
          resolve();
        }
        this.queue = this.queue
          .then(() => this.handle(message))
          .catch((error: unknown) => console.warn('sala:', error));
      };

      ws.onclose = (event: CloseEvent) => {
        if (this.closed) return;
        const code = event.reason || '';
        const reason = CLOSE_REASONS[code] ?? 'Se cortó la conexión con el servidor.';
        if (!welcomed) {
          this.close();
          reject(new MeshError(reason, code));
        } else {
          this.close();
          this.handlers.closed?.(reason, code);
        }
      };
    });
  }

  // ─── Enviar ──────────────────────────────────────────────────────────────────

  /** Le manda algo a una persona por el canal de datos. `false` si no está conectada. */
  send(memberId: string, payload: unknown): boolean {
    const channel = this.channels.get(memberId);
    if (channel?.readyState !== 'open') return false;
    try {
      channel.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /** Le manda algo a todos los conectados. Devuelve a cuántos llegó. */
  broadcast(payload: unknown): number {
    let sent = 0;
    for (const memberId of this.channels.keys()) if (this.send(memberId, payload)) sent += 1;
    return sent;
  }

  /** Con quién hay un canal de datos abierto ahora mismo. */
  connected(): string[] {
    return [...this.channels.entries()].filter(([, c]) => c.readyState === 'open').map(([id]) => id);
  }

  setState(mic: boolean): void {
    this.signal({ type: 'state', mic, cam: false });
  }

  /** Ida y vuelta real con una persona, en ms, según las estadísticas de WebRTC. */
  async rtt(memberId: string): Promise<number | null> {
    const pc = this.connections.get(memberId);
    if (!pc) return null;
    try {
      const stats = await pc.getStats();
      let best: number | null = null;
      stats.forEach((report: RTCStats & { state?: string; nominated?: boolean; currentRoundTripTime?: number }) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
          const ms = report.currentRoundTripTime * 1000;
          if (best === null || report.nominated) best = ms;
        }
      });
      return best;
    } catch {
      return null;
    }
  }

  // ─── Señalización ────────────────────────────────────────────────────────────

  private signal(message: ClientSignal): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private async handle(message: ServerSignal): Promise<void> {
    if (this.closed) return;
    switch (message.type) {
      case 'welcome': {
        this.selfId = message.you;
        this.iceServers = (message.ice_servers ?? []).map((urls) => ({ urls }));
        const peers = (message.peers ?? []).filter((p) => p.member_id !== message.you);
        for (const peer of peers) this.peers.set(peer.member_id, peer);
        this.handlers.welcome?.(message.you, peers);
        for (const peer of peers) await this.offerTo(peer.member_id);
        return;
      }
      case 'peer-joined': {
        const { peer } = message;
        if (peer.member_id === this.selfId) return;
        // Si ya había una conexión es de una entrada anterior: la nueva viene con oferta.
        this.dropConnection(peer.member_id);
        this.peers.set(peer.member_id, peer);
        this.handlers.peerJoined?.(peer);
        return;
      }
      case 'peer-left':
        this.dropConnection(message.member_id);
        this.peers.delete(message.member_id);
        this.handlers.peerLeft?.(message.member_id);
        return;
      case 'peer-state': {
        const peer = this.peers.get(message.member_id);
        if (peer) peer.mic = message.mic;
        this.handlers.peerState?.(message.member_id, message.mic);
        return;
      }
      case 'offer':
        await this.acceptOffer(message.from, message.payload);
        return;
      case 'answer': {
        const pc = this.connections.get(message.from);
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(message.payload);
          await this.flushIce(message.from);
        }
        return;
      }
      case 'ice':
        await this.addIce(message.from, message.payload);
        return;
      default:
        return; // mensajes desconocidos se ignoran, como pide el contrato
    }
  }

  private createConnection(memberId: string, initiator: boolean): RTCPeerConnection {
    this.dropConnection(memberId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    if (this.stream) for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    if (this.data) {
      if (initiator) this.setupChannel(memberId, pc.createDataChannel(DATA_LABEL, { ordered: true }));
      else pc.ondatachannel = (event) => this.setupChannel(memberId, event.channel);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) this.signal({ type: 'ice', to: memberId, candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (remote) this.handlers.track?.(memberId, remote);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && this.connections.get(memberId) === pc) this.scheduleRetry(memberId);
    };

    this.connections.set(memberId, pc);
    return pc;
  }

  private setupChannel(memberId: string, channel: RTCDataChannel): void {
    this.channels.set(memberId, channel);
    channel.onopen = () => this.handlers.open?.(memberId);
    channel.onmessage = (event: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handlers.message?.(memberId, payload);
    };
    channel.onclose = () => {
      if (this.channels.get(memberId) === channel) this.channels.delete(memberId);
    };
  }

  private async offerTo(memberId: string): Promise<void> {
    const pc = this.createConnection(memberId, true);
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.localDescription) this.signal({ type: 'offer', to: memberId, sdp: pc.localDescription.toJSON() });
  }

  private async acceptOffer(memberId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    // Una oferta nueva reemplaza cualquier conexión anterior con esa persona.
    const pending = this.pendingIce.get(memberId);
    const pc = this.createConnection(memberId, false);
    if (pending) this.pendingIce.set(memberId, pending);
    await pc.setRemoteDescription(sdp);
    await this.flushIce(memberId);
    await pc.setLocalDescription(await pc.createAnswer());
    if (pc.localDescription) this.signal({ type: 'answer', to: memberId, sdp: pc.localDescription.toJSON() });
  }

  private async addIce(memberId: string, candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!candidate) return;
    const pc = this.connections.get(memberId);
    if (!pc?.remoteDescription) {
      const queue = this.pendingIce.get(memberId) ?? [];
      queue.push(candidate);
      this.pendingIce.set(memberId, queue);
      return;
    }
    await pc.addIceCandidate(candidate).catch(() => {});
  }

  private async flushIce(memberId: string): Promise<void> {
    const pc = this.connections.get(memberId);
    const queue = this.pendingIce.get(memberId) ?? [];
    this.pendingIce.delete(memberId);
    if (!pc) return;
    for (const candidate of queue) await pc.addIceCandidate(candidate).catch(() => {});
  }

  private scheduleRetry(memberId: string): void {
    if (!this.selfId || this.selfId < memberId || this.retries.has(memberId)) return;
    this.retries.set(
      memberId,
      setTimeout(() => {
        this.retries.delete(memberId);
        if (!this.closed && this.peers.has(memberId)) {
          this.offerTo(memberId).catch((error: unknown) => console.warn('sala: reintento', error));
        }
      }, RETRY_DELAY_MS),
    );
  }

  private dropConnection(memberId: string): void {
    const retry = this.retries.get(memberId);
    if (retry) clearTimeout(retry);
    this.retries.delete(memberId);
    const channel = this.channels.get(memberId);
    if (channel) {
      channel.onclose = null;
      channel.close();
    }
    this.channels.delete(memberId);
    this.connections.get(memberId)?.close();
    this.connections.delete(memberId);
    this.pendingIce.delete(memberId);
  }

  // ─── Salir ──────────────────────────────────────────────────────────────────

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      if (this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    }
    for (const memberId of [...this.connections.keys()]) this.dropConnection(memberId);
    this.peers.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** La URL del socket de una sala. */
export function roomUrl(baseUrl: string, serverId: string, channelId: string, token: string): string {
  const url = new URL(`/api/v1/servers/${serverId}/channels/${channelId}/call`, baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}
