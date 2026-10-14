// Canales de voz: WebRTC entre pares, con el grupo como presentador.
//
// El servidor no transporta audio. Por el WebSocket de la llamada solo pasan
// las presentaciones (ofertas, respuestas y candidatos ICE) y el estado del
// micrófono. El audio va directo de una compu a la otra (full-mesh): cada uno
// conecta con todos.
//
// Quien entra le ofrece conexión a los que ya estaban; los que ya estaban
// esperan esa oferta. Así nunca hay dos ofertas cruzadas para el mismo par.

import { callSocketUrl } from './api';
import { byId } from './util';
import type { CallParticipant, Member } from './types';

const SPEAKING_THRESHOLD = 0.04;
const SPEAKING_INTERVAL_MS = 150;

// El micrófono propio se mide antes de saber qué id nos dio el servidor.
const SELF = 'self';

const CLOSE_REASONS: Record<string, string> = {
  missing_token: 'Falta tu sesión en este servidor.',
  invalid_token: 'Tu sesión venció. Volvé a entrar al servidor.',
  wrong_server: 'Tu sesión es de otro servidor.',
  channel_not_found: 'Ese canal de voz ya no existe.',
  server_not_found: 'El servidor ya no existe.',
  call_target_not_found: 'Ese canal de voz ya no existe.',
};

// Lo que manda el servidor por el socket de la llamada
// (ver `apps/servers/api/calls.py`).
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

/** No se pudo entrar a la llamada. `code` es el motivo que mandó el servidor al cerrar. */
export class CallError extends Error {
  readonly code: string;

  constructor(message: string, code = '') {
    super(message);
    this.name = 'CallError';
    this.code = code;
  }
}

function micErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Recop no tiene permiso para usar el micrófono.';
  if (name === 'NotFoundError') return 'No encontramos ningún micrófono conectado.';
  return 'No se pudo abrir el micrófono.';
}

export type CallState = 'connecting' | 'connected' | 'ended';

export interface VoiceCallOptions {
  baseUrl: string;
  serverId: string;
  channelId: string;
  channelName: string;
  serverName: string;
  token: string;
  self: Pick<Member, 'nickname' | 'display_name'>;
  /** `kind` es 'speaking' cuando solo cambió quién habla. */
  onChange?: (call: VoiceCall, kind?: 'speaking') => void;
  onEnd?: (call: VoiceCall, reason: string | null) => void;
}

export class VoiceCall {
  readonly baseUrl: string;
  readonly serverId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly serverName: string;

  selfId: string | null = null;
  muted = false;
  deafened = false;
  state: CallState = 'connecting';

  private readonly token: string;
  private readonly self: VoiceCallOptions['self'];
  private readonly onChange: NonNullable<VoiceCallOptions['onChange']>;
  private readonly onEnd: NonNullable<VoiceCallOptions['onEnd']>;

  private iceServers: RTCIceServer[] = [];
  private localStream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private readonly connections = new Map<string, RTCPeerConnection>();
  /** Candidatos que llegaron antes que la oferta de ese par. */
  private readonly pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private readonly participants = new Map<string, CallParticipant>();
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly speaking = new Set<string>();
  private readonly analysers = new Map<string, AnalyserNode>();
  private audioContext: AudioContext | null = null;
  private speakingTimer: ReturnType<typeof setInterval> | null = null;
  private ended = false;

  constructor(options: VoiceCallOptions) {
    this.baseUrl = options.baseUrl;
    this.serverId = options.serverId;
    this.channelId = options.channelId;
    this.channelName = options.channelName;
    this.serverName = options.serverName;
    this.token = options.token;
    this.self = options.self;
    this.onChange = options.onChange ?? (() => {});
    this.onEnd = options.onEnd ?? (() => {});
  }

  // Abre el micrófono y entra a la sala. Resuelve cuando el servidor da la
  // bienvenida; falla si no hay micrófono o si el servidor rechaza la entrada.
  async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      this.end(null, { silent: true });
      throw new CallError(micErrorMessage(error));
    }
    this.localStream = stream;
    this.watchSpeaking(SELF, stream);

    return new Promise<void>((resolve, reject) => {
      let welcomed = false;
      const ws = new WebSocket(callSocketUrl(this.baseUrl, this.serverId, this.channelId, this.token));
      this.ws = ws;

      ws.onmessage = (event: MessageEvent<string>) => {
        let message: ServerSignal;
        try {
          message = JSON.parse(event.data) as ServerSignal;
        } catch {
          return;
        }
        if (message.type === 'welcome') {
          welcomed = true;
          this.state = 'connected';
          resolve();
        }
        this.handle(message).catch((error: unknown) => console.warn('llamada:', error));
      };

      ws.onclose = (event: CloseEvent) => {
        const reason = CLOSE_REASONS[event.reason] ?? 'Se cortó la conexión con el servidor.';
        if (!welcomed) {
          this.end(null, { silent: true });
          reject(new CallError(reason, event.reason));
        } else if (!this.ended) {
          this.end(reason);
        }
      };
    });
  }

  private send(message: ClientSignal): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private async handle(message: ServerSignal): Promise<void> {
    switch (message.type) {
      case 'welcome': {
        this.selfId = message.you;
        this.iceServers = (message.ice_servers ?? []).map((urls) => ({ urls }));
        this.participants.set(message.you, {
          member_id: message.you,
          nickname: this.self.nickname,
          display_name: this.self.display_name,
          mic: !this.muted,
          cam: false,
        });
        for (const peer of message.peers ?? []) {
          this.participants.set(peer.member_id, peer);
          await this.offerTo(peer.member_id);
        }
        this.sendState();
        break;
      }
      case 'peer-joined':
        this.participants.set(message.peer.member_id, message.peer);
        break;
      case 'peer-left':
        this.dropPeer(message.member_id);
        break;
      case 'peer-state': {
        const peer = this.participants.get(message.member_id);
        if (peer) peer.mic = message.mic;
        break;
      }
      case 'offer':
        await this.acceptOffer(message.from, message.payload);
        break;
      case 'answer': {
        const pc = this.connections.get(message.from);
        if (pc) {
          await pc.setRemoteDescription(message.payload);
          await this.flushIce(message.from);
        }
        break;
      }
      case 'ice':
        await this.addIce(message.from, message.payload);
        break;
      default:
        return; // mensajes desconocidos se ignoran, como pide el contrato
    }
    this.onChange(this);
  }

  private connectionFor(memberId: string): RTCPeerConnection {
    const existing = this.connections.get(memberId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const stream = this.localStream;
    if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = (event) => {
      if (event.candidate) this.send({ type: 'ice', to: memberId, candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (remote) this.attachAudio(memberId, remote);
    };

    this.connections.set(memberId, pc);
    return pc;
  }

  private async offerTo(memberId: string): Promise<void> {
    const pc = this.connectionFor(memberId);
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.localDescription) this.send({ type: 'offer', to: memberId, sdp: pc.localDescription.toJSON() });
  }

  private async acceptOffer(memberId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.connectionFor(memberId);
    await pc.setRemoteDescription(sdp);
    await this.flushIce(memberId);
    await pc.setLocalDescription(await pc.createAnswer());
    if (pc.localDescription) this.send({ type: 'answer', to: memberId, sdp: pc.localDescription.toJSON() });
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

  private attachAudio(memberId: string, stream: MediaStream): void {
    let audio = this.audioElements.get(memberId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      byId('audio-sink').append(audio);
      this.audioElements.set(memberId, audio);
    }
    audio.srcObject = stream;
    audio.muted = this.deafened;
    this.watchSpeaking(memberId, stream);
  }

  private dropPeer(memberId: string): void {
    this.connections.get(memberId)?.close();
    this.connections.delete(memberId);
    this.pendingIce.delete(memberId);
    this.participants.delete(memberId);
    this.speaking.delete(memberId);
    this.analysers.delete(memberId);
    const audio = this.audioElements.get(memberId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
    this.audioElements.delete(memberId);
  }

  // ─── Micrófono y auriculares ────────────────────────────────────────────────

  get micOn(): boolean {
    return !this.muted && !this.deafened;
  }

  private applyMic(): void {
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = this.micOn;
    }
    const me = this.selfId ? this.participants.get(this.selfId) : undefined;
    if (me) me.mic = this.micOn;
    this.sendState();
    this.onChange(this);
  }

  private sendState(): void {
    this.send({ type: 'state', mic: this.micOn, cam: false });
  }

  toggleMute(): void {
    // Con los auriculares apagados, tocar el micrófono los vuelve a prender,
    // como en Discord: no tiene sentido hablar sin escuchar.
    if (this.deafened) {
      this.deafened = false;
      this.muted = false;
      this.applyDeafen();
    } else {
      this.muted = !this.muted;
    }
    this.applyMic();
  }

  toggleDeafen(): void {
    this.deafened = !this.deafened;
    this.applyDeafen();
    this.applyMic();
  }

  private applyDeafen(): void {
    for (const audio of this.audioElements.values()) audio.muted = this.deafened;
  }

  // ─── Quién está hablando ────────────────────────────────────────────────────

  private watchSpeaking(memberId: string, stream: MediaStream): void {
    try {
      this.audioContext ??= new AudioContext();
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      this.audioContext.createMediaStreamSource(stream).connect(analyser);
      this.analysers.set(memberId, analyser);
    } catch {
      return; // sin indicador de voz; la llamada anda igual
    }
    this.speakingTimer ??= setInterval(() => this.measureSpeaking(), SPEAKING_INTERVAL_MS);
  }

  private measureSpeaking(): void {
    const samples = new Uint8Array(512);
    let changed = false;
    for (const [memberId, analyser] of this.analysers) {
      const id = memberId === SELF ? this.selfId : memberId;
      if (!id) continue;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += ((value - 128) / 128) ** 2;
      const level = Math.sqrt(sum / samples.length);
      const talking = level > SPEAKING_THRESHOLD && (memberId !== SELF || this.micOn);
      if (talking !== this.speaking.has(id)) {
        if (talking) this.speaking.add(id);
        else this.speaking.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange(this, 'speaking');
  }

  isSpeaking(memberId: string | null | undefined): boolean {
    return Boolean(memberId && this.speaking.has(memberId));
  }

  // ─── Salir ──────────────────────────────────────────────────────────────────

  end(reason: string | null = null, { silent = false } = {}): void {
    if (this.ended) return;
    this.ended = true;
    this.state = 'ended';

    if (this.ws) {
      this.ws.onclose = null;
      if (this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    }
    for (const memberId of [...this.connections.keys()]) this.dropPeer(memberId);
    if (this.localStream) for (const track of this.localStream.getTracks()) track.stop();
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    if (this.audioContext) this.audioContext.close().catch(() => {});

    if (!silent) this.onEnd(this, reason);
  }

  list(): CallParticipant[] {
    return [...this.participants.values()];
  }
}
