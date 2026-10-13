// Canales de voz: WebRTC entre pares, con el grupo como presentador.
//
// El servidor no transporta audio. Por el WebSocket de la llamada solo pasan
// las presentaciones (ofertas, respuestas y candidatos ICE) y el estado del
// micrófono. El audio va directo de una compu a la otra (full-mesh): cada uno
// conecta con todos.
//
// Quien entra le ofrece conexión a los que ya estaban; los que ya estaban
// esperan esa oferta. Así nunca hay dos ofertas cruzadas para el mismo par.

(function (R) {
  'use strict';

  const SPEAKING_THRESHOLD = 0.04;
  const SPEAKING_INTERVAL_MS = 150;

  const CLOSE_REASONS = {
    missing_token: 'Falta tu sesión en este servidor.',
    invalid_token: 'Tu sesión venció. Volvé a entrar al servidor.',
    wrong_server: 'Tu sesión es de otro servidor.',
    channel_not_found: 'Ese canal de voz ya no existe.',
    server_not_found: 'El servidor ya no existe.',
    call_target_not_found: 'Ese canal de voz ya no existe.',
  };

  function micErrorMessage(error) {
    if (error && error.name === 'NotAllowedError') return 'Recop no tiene permiso para usar el micrófono.';
    if (error && error.name === 'NotFoundError') return 'No encontramos ningún micrófono conectado.';
    return 'No se pudo abrir el micrófono.';
  }

  class VoiceCall {
    constructor({ baseUrl, serverId, channelId, channelName, serverName, token, self, onChange, onEnd }) {
      this.baseUrl = baseUrl;
      this.serverId = serverId;
      this.channelId = channelId;
      this.channelName = channelName;
      this.serverName = serverName;
      this.token = token;
      this.self = self; // { id, nickname, display_name }
      this.onChange = onChange || (() => {});
      this.onEnd = onEnd || (() => {});

      this.selfId = null;
      this.iceServers = [];
      this.localStream = null;
      this.ws = null;
      this.connections = new Map(); // member_id → RTCPeerConnection
      this.pendingIce = new Map(); // member_id → candidatos que llegaron antes que la oferta
      this.participants = new Map(); // member_id → { member_id, nickname, display_name, mic }
      this.audioElements = new Map();
      this.speaking = new Set();
      this.analysers = new Map();
      this.audioContext = null;
      this.speakingTimer = null;

      this.muted = false;
      this.deafened = false;
      this.state = 'connecting'; // connecting | connected | ended
      this.ended = false;
    }

    get key() {
      return `${this.baseUrl}|${this.serverId}|${this.channelId}`;
    }

    // Abre el micrófono y entra a la sala. Resuelve cuando el servidor da la
    // bienvenida; falla si no hay micrófono o si el servidor rechaza la entrada.
    async start() {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (error) {
        this.end(null, { silent: true });
        throw new Error(micErrorMessage(error));
      }

      this.watchSpeaking('self', this.localStream);

      return new Promise((resolve, reject) => {
        let welcomed = false;
        const url = R.api.callSocketUrl(this.baseUrl, this.serverId, this.channelId, this.token);
        this.ws = new WebSocket(url);

        this.ws.onmessage = (event) => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          if (message.type === 'welcome') {
            welcomed = true;
            this.state = 'connected';
            resolve();
          }
          this.handle(message).catch((error) => console.warn('llamada:', error));
        };

        this.ws.onclose = (event) => {
          const reason = CLOSE_REASONS[event.reason] || 'Se cortó la conexión con el servidor.';
          if (!welcomed) {
            this.end(null, { silent: true });
            const error = new Error(reason);
            error.code = event.reason;
            reject(error);
          } else if (!this.ended) {
            this.end(reason);
          }
        };
      });
    }

    send(message) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    }

    async handle(message) {
      switch (message.type) {
        case 'welcome': {
          this.selfId = message.you;
          this.iceServers = (message.ice_servers || []).map((urls) => ({ urls }));
          this.participants.set(message.you, {
            member_id: message.you,
            nickname: this.self.nickname,
            display_name: this.self.display_name,
            mic: !this.muted,
          });
          for (const peer of message.peers || []) {
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

    connectionFor(memberId) {
      let pc = this.connections.get(memberId);
      if (pc) return pc;

      pc = new RTCPeerConnection({ iceServers: this.iceServers });
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

      pc.onicecandidate = (event) => {
        if (event.candidate) this.send({ type: 'ice', to: memberId, candidate: event.candidate.toJSON() });
      };
      pc.ontrack = (event) => this.attachAudio(memberId, event.streams[0]);

      this.connections.set(memberId, pc);
      return pc;
    }

    async offerTo(memberId) {
      const pc = this.connectionFor(memberId);
      await pc.setLocalDescription(await pc.createOffer());
      this.send({ type: 'offer', to: memberId, sdp: pc.localDescription.toJSON() });
    }

    async acceptOffer(memberId, sdp) {
      const pc = this.connectionFor(memberId);
      await pc.setRemoteDescription(sdp);
      await this.flushIce(memberId);
      await pc.setLocalDescription(await pc.createAnswer());
      this.send({ type: 'answer', to: memberId, sdp: pc.localDescription.toJSON() });
    }

    async addIce(memberId, candidate) {
      if (!candidate) return;
      const pc = this.connections.get(memberId);
      if (!pc || !pc.remoteDescription) {
        const queue = this.pendingIce.get(memberId) || [];
        queue.push(candidate);
        this.pendingIce.set(memberId, queue);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    }

    async flushIce(memberId) {
      const pc = this.connections.get(memberId);
      const queue = this.pendingIce.get(memberId) || [];
      this.pendingIce.delete(memberId);
      for (const candidate of queue) await pc.addIceCandidate(candidate).catch(() => {});
    }

    attachAudio(memberId, stream) {
      let audio = this.audioElements.get(memberId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        document.getElementById('audio-sink').append(audio);
        this.audioElements.set(memberId, audio);
      }
      audio.srcObject = stream;
      audio.muted = this.deafened;
      this.watchSpeaking(memberId, stream);
    }

    dropPeer(memberId) {
      const pc = this.connections.get(memberId);
      if (pc) pc.close();
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

    // ─── Micrófono y auriculares ──────────────────────────────────────────────

    get micOn() {
      return !this.muted && !this.deafened;
    }

    applyMic() {
      if (this.localStream) {
        for (const track of this.localStream.getAudioTracks()) track.enabled = this.micOn;
      }
      const me = this.participants.get(this.selfId);
      if (me) me.mic = this.micOn;
      this.sendState();
      this.onChange(this);
    }

    sendState() {
      this.send({ type: 'state', mic: this.micOn, cam: false });
    }

    toggleMute() {
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

    toggleDeafen() {
      this.deafened = !this.deafened;
      this.applyDeafen();
      this.applyMic();
    }

    applyDeafen() {
      for (const audio of this.audioElements.values()) audio.muted = this.deafened;
    }

    // ─── Quién está hablando ──────────────────────────────────────────────────

    watchSpeaking(memberId, stream) {
      try {
        this.audioContext = this.audioContext || new AudioContext();
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 512;
        this.audioContext.createMediaStreamSource(stream).connect(analyser);
        this.analysers.set(memberId, analyser);
      } catch {
        return; // sin indicador de voz; la llamada anda igual
      }
      if (!this.speakingTimer) {
        this.speakingTimer = setInterval(() => this.measureSpeaking(), SPEAKING_INTERVAL_MS);
      }
    }

    measureSpeaking() {
      const samples = new Uint8Array(512);
      let changed = false;
      for (const [memberId, analyser] of this.analysers) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += ((value - 128) / 128) ** 2;
        const level = Math.sqrt(sum / samples.length);
        const id = memberId === 'self' ? this.selfId : memberId;
        const talking = level > SPEAKING_THRESHOLD && (memberId !== 'self' || this.micOn);
        if (talking !== this.speaking.has(id)) {
          if (talking) this.speaking.add(id);
          else this.speaking.delete(id);
          changed = true;
        }
      }
      if (changed) this.onChange(this, 'speaking');
    }

    isSpeaking(memberId) {
      return this.speaking.has(memberId);
    }

    // ─── Salir ────────────────────────────────────────────────────────────────

    end(reason = null, { silent = false } = {}) {
      if (this.ended) return;
      this.ended = true;
      this.state = 'ended';

      if (this.ws) {
        this.ws.onclose = null;
        if (this.ws.readyState <= WebSocket.OPEN) this.ws.close();
      }
      for (const memberId of [...this.connections.keys()]) this.dropPeer(memberId);
      if (this.localStream) for (const track of this.localStream.getTracks()) track.stop();
      clearInterval(this.speakingTimer);
      if (this.audioContext) this.audioContext.close().catch(() => {});

      if (!silent) this.onEnd(this, reason);
    }

    list() {
      return [...this.participants.values()];
    }
  }

  R.VoiceCall = VoiceCall;
})(window.Recop);
