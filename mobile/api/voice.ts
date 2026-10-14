/**
 * Capa de voz.
 *
 * La app usa `VoiceEngine` y no sabe qué hay detrás. Hoy hay un solo motor,
 * `MockVoiceEngine`, que simula quién habla para que la interfaz (anillos,
 * ondas, latencia) se vea viva sin backend.
 *
 * Para conectar voz de verdad hay dos caminos, los dos detrás de esta misma
 * interfaz:
 *
 * 1. **WebRTC nativo con Recop** (lo que ya implementa el backend): el grupo
 *    expone `WS /api/v1/servers/{id}/channels/{id}/call?token=…` para la
 *    señalización (offer/answer/ice) y el audio va P2P. Necesita
 *    `react-native-webrtc` y por lo tanto un development build (no Expo Go).
 *    El cliente de escritorio (front/src/renderer/call.ts) ya implementa ese
 *    protocolo y se puede portar casi tal cual.
 * 2. **LiveKit** (`@livekit/react-native`), si algún día se usa un SFU.
 */

export interface VoiceEngine {
  join(channelId: string, selfId: string, peerIds: string[]): Promise<void>;
  leave(): void;
  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  /** Alguien empezó o dejó de hablar. Devuelve la función para desuscribirse. */
  onSpeaking(listener: (userId: string, speaking: boolean) => void): () => void;
}

export class MockVoiceEngine implements VoiceEngine {
  private listeners = new Set<(userId: string, speaking: boolean) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private peers: string[] = [];
  private selfId = '';
  private muted = false;
  private speaking = new Map<string, boolean>();

  async join(_channelId: string, selfId: string, peerIds: string[]): Promise<void> {
    this.leave();
    this.selfId = selfId;
    this.peers = peerIds;
    // Simula el tiempo de negociar la conexión.
    await new Promise((resolve) => setTimeout(resolve, 600));
    this.timer = setInterval(() => this.tick(), 650);
  }

  leave(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [userId, on] of this.speaking) if (on) this.set(userId, false);
    this.speaking.clear();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.set(this.selfId, false);
  }

  setDeafened(deafened: boolean): void {
    if (deafened) this.setMuted(true);
  }

  /** Para el mock: otra persona entró o salió de la sala. */
  setPeers(peerIds: string[]): void {
    for (const id of this.peers) if (!peerIds.includes(id)) this.set(id, false);
    this.peers = peerIds;
  }

  onSpeaking(listener: (userId: string, speaking: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private tick(): void {
    // Conversación creíble: casi siempre habla una sola persona a la vez.
    for (const id of this.peers) {
      const now = this.speaking.get(id) ?? false;
      const next = now ? Math.random() < 0.65 : Math.random() < 0.18;
      this.set(id, next);
    }
    if (!this.muted) this.set(this.selfId, Math.random() < 0.2);
  }

  private set(userId: string, speaking: boolean): void {
    if ((this.speaking.get(userId) ?? false) === speaking) return;
    this.speaking.set(userId, speaking);
    for (const listener of this.listeners) listener(userId, speaking);
  }
}

export const voiceEngine = new MockVoiceEngine();
