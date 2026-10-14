// El HUD de la llamada: una tarjeta por persona con su onda (el nivel real de
// su audio), un anillo cuando habla, el micrófono y la latencia con cada una.

import { leaveVoice, openVoice, toggleDeafen, toggleMute } from '../actions';
import { duration } from '../lib/format';
import type { CallParticipant, Session } from '../lib/types';
import { useApp } from '../store/app';
import { useVoice, WAVE_BARS } from '../store/voice';
import { latencyState, useNow } from './hooks';
import { Avatar, Button, Icon, type IconName } from './ui';
import { NetMonitor } from './Widgets';

function Wave({ levels, speaking }: { levels: number[]; speaking: boolean }) {
  const bars = [...Array(Math.max(0, WAVE_BARS - levels.length)).fill(0), ...levels] as number[];
  return (
    <div className={speaking ? 'wave speaking' : 'wave'} aria-hidden="true">
      {bars.map((level, i) => (
        <span key={i} style={{ height: `${Math.max(6, level * 100)}%` }} />
      ))}
    </div>
  );
}

function Tile({ person, self }: { person: CallParticipant; self: boolean }) {
  const speaking = useVoice((s) => Boolean(s.call?.speaking[person.member_id]));
  const levels = useVoice((s) => s.call?.levels[person.member_id]) ?? [];
  const rtt = useVoice((s) => s.call?.rtt[person.member_id]);
  const latency = latencyState(self ? 0 : (rtt ?? null));
  return (
    <div className={speaking ? 'voice-tile speaking' : 'voice-tile'}>
      <Avatar name={person.display_name} nick={person.nickname} size={72} speaking={speaking} />
      <div className="voice-tile-name">
        {person.display_name}
        {self ? <span className="dim"> (vos)</span> : null}
      </div>
      <Wave levels={levels} speaking={speaking} />
      <div className="voice-tile-foot">
        <span className={self ? 'dim' : `tone-${latency.tone}`}>
          {self ? 'local' : rtt == null ? 'conectando…' : `${Math.round(rtt)}ms`}
        </span>
        <Icon name={person.mic ? 'mic' : 'mic-off'} size={14} className={person.mic ? 'dim' : 'muted-icon'} />
      </div>
    </div>
  );
}

function Control({ icon, label, active, danger, onClick }: { icon: IconName; label: string; active?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={['voice-control', active ? 'active' : '', danger ? 'danger' : ''].filter(Boolean).join(' ')} onClick={onClick}>
      <span className="voice-control-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="voice-control-label">{label}</span>
    </button>
  );
}

export function Voice({ session, channelId }: { session: Session; channelId: string }) {
  const call = useVoice((s) => s.call);
  const server = useApp((s) => s.servers[session.key]);
  const now = useNow(1000);
  const channel = server?.channels.find((c) => c.id === channelId);
  const here = call && call.key === session.key && call.channelId === channelId;

  if (!here) {
    return (
      <section className="voice-hud panel glass">
        <div className="home-empty">
          <Icon name="headphones" size={32} />
          <h2>{channel?.name ?? 'Canal de voz'}</h2>
          <p>El audio va directo entre las compus de la sala: el servidor solo las presenta.</p>
          <Button tone="lime" solid icon="phone" onClick={() => void openVoice(session.key, channelId)}>
            Conectar
          </Button>
        </div>
      </section>
    );
  }

  const people = call.participants.length ? call.participants : [];
  return (
    <section className="voice-hud panel glass">
      <header className="voice-head">
        <div>
          <span className={call.state === 'connected' ? 'voice-state ok' : 'voice-state'}>
            <span className="wb-dot" />
            {call.state === 'connected' ? 'voz conectada' : 'negociando conexión…'}
          </span>
          <h1>
            <Icon name="volume-2" size={22} /> {call.channelName}
          </h1>
          <p>
            {call.serverName} · {people.length} en la sala · p2p webrtc
          </p>
        </div>
        <span className="voice-timer mono">{call.state === 'connected' ? duration(call.joinedAt, now) : '--:--'}</span>
      </header>

      <div className="voice-grid">
        {people.map((person) => (
          <Tile key={person.member_id} person={person} self={person.member_id === call.selfId} />
        ))}
        {people.length === 1 ? (
          <div className="voice-tile ghost">
            <Icon name="user-plus" size={28} />
            <span>Estás solo. Cuando alguien entre a {call.channelName} aparece acá.</span>
          </div>
        ) : null}
      </div>

      <div className="voice-controls glass-strong">
        <Control icon={call.muted || call.deafened ? 'mic-off' : 'mic'} label={call.muted ? 'activar' : 'silenciar'} active={call.muted || call.deafened} onClick={toggleMute} />
        <Control icon={call.deafened ? 'volume-x' : 'headphones'} label={call.deafened ? 'escuchar' : 'ensordecer'} active={call.deafened} onClick={toggleDeafen} />
        <Control icon="phone-off" label="salir" danger onClick={leaveVoice} />
      </div>

      <div className="widgets-row">
        <NetMonitor />
      </div>
    </section>
  );
}
