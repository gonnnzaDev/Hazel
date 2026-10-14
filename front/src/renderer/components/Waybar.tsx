// La barra de arriba, estilo Waybar: espacios de trabajo (tus servidores), la
// hora y los módulos de estado. Todo es real: la latencia se mide contra el
// nodo, la CPU y la batería son las de esta compu, y P2P cuenta a la gente
// conectada de verdad.

import { currentKey, goHome, leaveVoice, mentionsOfMe, selectSession } from '../actions';
import { clock, duration } from '../lib/format';
import { useApp } from '../store/app';
import { unreadOfSession, useChat } from '../store/chat';
import { useSessions } from '../store/sessions';
import { useVoice } from '../store/voice';
import { latencyState, useBattery, useNow } from './hooks';
import { Icon, Logo } from './ui';

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function Workspaces() {
  const sessions = useSessions((s) => s.sessions);
  const view = useApp((s) => s.view);
  const chat = useChat();
  const active = currentKey(view);
  return (
    <div className="wb-workspaces" role="tablist" aria-label="Espacios de trabajo">
      <button type="button" className={active ? 'wb-ws' : 'wb-ws active'} onClick={goHome} title="Mi nodo (Ctrl+0)">
        ~
      </button>
      {sessions.slice(0, 9).map((session, i) => {
        const unread = unreadOfSession(chat, session.key, session.member.id, session.member.nickname);
        const classes = ['wb-ws', active === session.key ? 'active' : '', unread.count ? 'unread' : '', unread.mentions ? 'mention' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={session.key}
            type="button"
            className={classes}
            onClick={() => selectSession(session.key)}
            title={`${session.name} (Ctrl+${i + 1})`}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

function VoiceModule() {
  const call = useVoice((s) => s.call);
  const now = useNow(1000);
  if (!call) return null;
  return (
    <button type="button" className="wb-module wb-voice" onClick={leaveVoice} title="Salir de la llamada">
      <span className="wb-dot" />
      <Icon name="volume-2" size={14} />
      <span>{call.channelName}</span>
      <span className="wb-dim">{call.state === 'connected' ? duration(call.joinedAt, now) : '…'}</span>
    </button>
  );
}

function LatencyModule() {
  const { ms, target } = useApp((s) => s.latency);
  const state = latencyState(ms);
  const icon = state.tone === 'down' ? 'wifi-off' : state.tone === 'good' ? 'activity' : 'alert-triangle';
  let host = target;
  try {
    host = new URL(target).host;
  } catch {
    // queda como está
  }
  return (
    <span className={`wb-module tone-${state.tone}`} title={`Latencia a ${host}: ${state.label}`}>
      <Icon name={icon} size={14} />
      <span>{ms === null ? '—' : `${Math.round(ms)}ms`}</span>
    </span>
  );
}

function PeersModule() {
  const view = useApp((s) => s.view);
  const key = currentKey(view);
  const bus = useChat((s) => (key ? s.bus[key] : undefined));
  const nodeStatus = useApp((s) => s.node.status);
  if (!key) {
    const tone = nodeStatus === 'online' ? 'good' : nodeStatus === 'connecting' ? 'warn' : 'down';
    return (
      <span className={`wb-module tone-${tone}`} title="Tu nodo">
        <Icon name="server" size={14} />
        <span>{nodeStatus === 'online' ? 'nodo' : nodeStatus === 'connecting' ? 'conectando' : 'nodo caído'}</span>
      </span>
    );
  }
  const status = bus?.status ?? 'connecting';
  const tone = status === 'online' ? 'good' : status === 'connecting' ? 'warn' : 'down';
  const label = status === 'online' ? `p2p ${bus?.connected.length ?? 0}` : status === 'connecting' ? 'conectando' : status === 'expired' ? 'sesión vencida' : 'sin conexión';
  return (
    <span className={`wb-module tone-${tone}`} title="Gente conectada con vos por P2P en este servidor">
      <Icon name={status === 'online' ? 'wifi' : 'wifi-off'} size={14} />
      <span>{label}</span>
    </span>
  );
}

function CpuModule() {
  const { cpu, available } = useApp((s) => s.system);
  if (!available) return null;
  const last = cpu[cpu.length - 1] ?? 0;
  return (
    <span className={`wb-module ${last > 0.85 ? 'tone-bad' : ''}`} title="Uso de CPU de esta compu">
      <Icon name="cpu" size={14} />
      <span>{Math.round(last * 100)}%</span>
    </span>
  );
}

function BatteryModule() {
  const battery = useBattery();
  if (!battery) return null;
  const pct = Math.round(battery.level * 100);
  return (
    <span className={`wb-module ${pct < 15 && !battery.charging ? 'tone-bad' : ''}`} title="Batería">
      <Icon name={battery.charging ? 'battery-charging' : 'battery'} size={14} />
      <span>{pct}%</span>
    </span>
  );
}

function MentionsBell() {
  useChat((s) => s.messages);
  const lastRead = useChat((s) => s.lastRead);
  const open = useApp((s) => s.mentionsOpen);
  const unread = mentionsOfMe().filter(({ key, message }) => message.createdAt > (lastRead[key]?.[message.channelId] ?? 0)).length;
  return (
    <button
      type="button"
      className={open ? 'wb-module wb-bell active' : 'wb-module wb-bell'}
      onClick={() => useApp.setState({ mentionsOpen: !open, wofiOpen: false })}
      aria-label="Menciones y mensajes directos"
      title="Menciones y mensajes directos"
    >
      <Icon name="bell" size={14} />
      {unread ? <span className="wb-bell-count">{unread > 99 ? '99+' : unread}</span> : null}
    </button>
  );
}

export function Waybar() {
  const now = new Date(useNow(1000));
  return (
    <header className="waybar glass">
      <div className="wb-left">
        <button type="button" className="wb-logo" onClick={goHome} aria-label="Mi nodo">
          <Logo size={22} />
        </button>
        <Workspaces />
      </div>
      <div className="wb-center">
        <span className="wb-clock">{clock(now, true)}</span>
        <span className="wb-date">
          {DAYS[now.getDay()]} {now.getDate()}/{now.getMonth() + 1}
        </span>
      </div>
      <div className="wb-right">
        <VoiceModule />
        <PeersModule />
        <LatencyModule />
        <CpuModule />
        <BatteryModule />
        <button
          type="button"
          className="wb-module"
          onClick={() => useApp.setState({ wofiOpen: true, mentionsOpen: false })}
          title="Buscar (Ctrl+K)"
          aria-label="Buscar"
        >
          <Icon name="search" size={14} />
          <span className="wb-kbd">Ctrl K</span>
        </button>
        <MentionsBell />
      </div>
    </header>
  );
}
