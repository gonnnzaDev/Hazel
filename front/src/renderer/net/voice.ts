// Canales de voz: el micrófono de cada uno va directo a los demás (net/mesh.ts).
//
// Además del audio, la app mide:
// - el nivel de cada persona (para la onda y el anillo de "está hablando"),
//   con un AnalyserNode sobre su audio real;
// - la ida y vuelta con cada una, con las estadísticas de WebRTC.

import type { CallParticipant, Session } from '../lib/types';
import { patchCall, useVoice, WAVE_BARS } from '../store/voice';
import { MeshError, PeerMesh, roomUrl } from './mesh';

const LEVEL_INTERVAL_MS = 80;
const RTT_INTERVAL_MS = 2000;
const SPEAKING_THRESHOLD = 0.035;
/** El micrófono propio se mide antes de saber qué id nos dio el servidor. */
const SELF = 'self';

export class VoiceError extends Error {}

function micErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Hazel no tiene permiso para usar el micrófono.';
  if (name === 'NotFoundError') return 'No encontramos ningún micrófono conectado.';
  return 'No se pudo abrir el micrófono.';
}

function audioSink(): HTMLElement {
  let sink = document.getElementById('audio-sink');
  if (!sink) {
    sink = document.createElement('div');
    sink.id = 'audio-sink';
    sink.hidden = true;
    document.body.append(sink);
  }
  return sink;
}

export interface VoiceOptions {
  session: Session;
  channelId: string;
  channelName: string;
  serverName: string;
  /** Se cortó sin que lo pidieras (el servidor se apagó, se cayó la red). */
  onDropped?(reason: string): void;
}

export class VoiceSession {
  readonly key: string;
  readonly channelId: string;
  private readonly options: VoiceOptions;
  private mesh: PeerMesh | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private readonly analysers = new Map<string, AnalyserNode>();
  private readonly audio = new Map<string, HTMLAudioElement>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private ended = false;

  constructor(options: VoiceOptions) {
    this.options = options;
    this.key = options.session.key;
    this.channelId = options.channelId;
  }

  async start(): Promise<void> {
    const { session, channelId, channelName, serverName } = this.options;
    useVoice.setState({
      call: {
        key: session.key,
        channelId,
        channelName,
        serverName,
        state: 'connecting',
        joinedAt: Date.now(),
        selfId: null,
        muted: false,
        deafened: false,
        participants: [],
        speaking: {},
        levels: {},
        rtt: {},
      },
    });

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      this.end();
      throw new VoiceError(micErrorMessage(error));
    }
    this.watch(SELF, this.stream);

    const mesh = new PeerMesh({
      url: roomUrl(session.baseUrl, session.serverId, channelId, session.token),
      stream: this.stream,
      handlers: {
        welcome: (selfId) => {
          patchCall({ state: 'connected', selfId, joinedAt: Date.now() });
          this.syncParticipants();
          mesh.setState(this.micOn);
        },
        peerJoined: () => this.syncParticipants(),
        peerLeft: (memberId) => {
          this.dropAudio(memberId);
          this.syncParticipants();
        },
        peerState: () => this.syncParticipants(),
        track: (memberId, remote) => this.attach(memberId, remote),
        closed: (reason) => {
          this.end();
          this.options.onDropped?.(reason);
        },
      },
    });
    this.mesh = mesh;

    try {
      await mesh.start();
    } catch (error) {
      this.end();
      throw new VoiceError(error instanceof MeshError ? error.message : 'No se pudo entrar al canal de voz.');
    }

    this.timers.push(setInterval(() => this.measureLevels(), LEVEL_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.measureRtt(), RTT_INTERVAL_MS));
  }

  // ─── Micrófono y auriculares ────────────────────────────────────────────────

  private get micOn(): boolean {
    const call = useVoice.getState().call;
    return Boolean(call && !call.muted && !call.deafened);
  }

  private applyMic(): void {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = this.micOn;
    for (const audio of this.audio.values()) audio.muted = Boolean(useVoice.getState().call?.deafened);
    this.mesh?.setState(this.micOn);
    this.syncParticipants();
  }

  toggleMute(): void {
    const call = useVoice.getState().call;
    if (!call) return;
    // Con los auriculares apagados, tocar el micrófono los vuelve a prender:
    // no tiene sentido hablar sin escuchar.
    if (call.deafened) patchCall({ deafened: false, muted: false });
    else patchCall({ muted: !call.muted });
    this.applyMic();
  }

  toggleDeafen(): void {
    const call = useVoice.getState().call;
    if (!call) return;
    patchCall({ deafened: !call.deafened });
    this.applyMic();
  }

  // ─── Participantes y audio ──────────────────────────────────────────────────

  private syncParticipants(): void {
    const call = useVoice.getState().call;
    if (!call || !this.mesh) return;
    const { session } = this.options;
    const self: CallParticipant = {
      member_id: this.mesh.selfId ?? session.member.id,
      nickname: session.member.nickname,
      display_name: session.member.display_name,
      mic: this.micOn,
      cam: false,
    };
    patchCall({ participants: [self, ...this.mesh.peers.values()] });
  }

  private attach(memberId: string, remote: MediaStream): void {
    let audio = this.audio.get(memberId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audioSink().append(audio);
      this.audio.set(memberId, audio);
    }
    audio.srcObject = remote;
    audio.muted = Boolean(useVoice.getState().call?.deafened);
    this.watch(memberId, remote);
  }

  private dropAudio(memberId: string): void {
    const audio = this.audio.get(memberId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
    this.audio.delete(memberId);
    this.analysers.delete(memberId);
  }

  private watch(memberId: string, stream: MediaStream): void {
    try {
      this.context ??= new AudioContext();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 512;
      this.context.createMediaStreamSource(stream).connect(analyser);
      this.analysers.set(memberId, analyser);
    } catch {
      // sin onda ni anillo para esa persona; la llamada anda igual
    }
  }

  private measureLevels(): void {
    const call = useVoice.getState().call;
    if (!call) return;
    const samples = new Uint8Array(512);
    const levels = { ...call.levels };
    const speaking: Record<string, boolean> = {};
    for (const [key, analyser] of this.analysers) {
      const id = key === SELF ? call.selfId : key;
      if (!id) continue;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += ((value - 128) / 128) ** 2;
      let level = Math.sqrt(sum / samples.length);
      if (key === SELF && !this.micOn) level = 0;
      speaking[id] = level > SPEAKING_THRESHOLD;
      // La onda escala el nivel para que una voz normal llene la barra.
      levels[id] = [...(levels[id] ?? []).slice(-(WAVE_BARS - 1)), Math.min(1, level * 4)];
    }
    patchCall({ levels, speaking });
  }

  private async measureRtt(): Promise<void> {
    if (!this.mesh) return;
    const rtt: Record<string, number | null> = {};
    for (const memberId of this.mesh.peers.keys()) rtt[memberId] = await this.mesh.rtt(memberId);
    patchCall({ rtt });
  }

  // ─── Salir ──────────────────────────────────────────────────────────────────

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const timer of this.timers) clearInterval(timer);
    this.mesh?.close();
    for (const memberId of [...this.audio.keys()]) this.dropAudio(memberId);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.context?.close().catch(() => {});
    useVoice.setState({ call: null });
  }
}
