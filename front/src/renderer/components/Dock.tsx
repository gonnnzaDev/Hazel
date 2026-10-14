// El dock flotante de la izquierda: tu nodo arriba, los servidores en los que
// estás, y abajo agregar uno y los ajustes.

import { currentKey, goHome, selectSession } from '../actions';
import { accentOf, alpha, initials } from '../lib/color';
import type { Session } from '../lib/types';
import { openModal, useApp } from '../store/app';
import { unreadOfSession, useChat } from '../store/chat';
import { useSessions } from '../store/sessions';
import { useVoice } from '../store/voice';
import { useShallow } from 'zustand/react/shallow';
import { Icon, Logo } from './ui';

function ServerButton({ session, active }: { session: Session; active: boolean }) {
  const unread = useChat(useShallow((s) => unreadOfSession(s, session.key, session.member.id, session.member.nickname)));
  const bus = useChat((s) => s.bus[session.key]);
  const server = useApp((s) => s.servers[session.key]);
  const unreachable = useApp((s) => s.unreachable[session.key]);
  const inCall = useVoice((s) => s.call?.key === session.key);
  const accent = accentOf(session.serverId);
  const off = session.expired || Boolean(unreachable) || server?.status === 'inactive';

  const title = [
    session.name,
    session.expired ? 'sesión vencida' : unreachable ? 'no responde' : server?.status === 'inactive' ? 'apagado' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={active ? 'dock-item active' : 'dock-item'}>
      <span className={unread.count && !active ? 'dock-pill unread' : 'dock-pill'} style={{ background: accent, boxShadow: `0 0 12px ${accent}` }} />
      <button
        type="button"
        className={off ? 'dock-server off' : 'dock-server'}
        onClick={() => selectSession(session.key)}
        aria-label={title}
        title={title}
        style={{
          borderColor: active ? accent : undefined,
          boxShadow: active ? `0 0 18px ${alpha(accent, 0.45)}, inset 0 0 12px ${alpha(accent, 0.18)}` : undefined,
          color: active ? accent : undefined,
        }}
      >
        {initials(session.name)}
      </button>
      {unread.mentions ? <span className="dock-badge">{unread.mentions > 99 ? '99+' : unread.mentions}</span> : null}
      {inCall ? <span className="dock-voice" title="Estás en una llamada acá"><Icon name="volume-2" size={10} /></span> : null}
      {bus?.status === 'online' && bus.connected.length ? <span className="dock-online" title={`${bus.connected.length} conectados`} /> : null}
    </div>
  );
}

export function Dock() {
  const sessions = useSessions((s) => s.sessions);
  const view = useApp((s) => s.view);
  const nodeStatus = useApp((s) => s.node.status);
  const active = currentKey(view);

  return (
    <nav className="dock glass" aria-label="Servidores">
      <div className={active ? 'dock-item' : 'dock-item active'}>
        <span className="dock-pill" />
        <button type="button" className="dock-home" onClick={goHome} aria-label="Mi nodo" title="Mi nodo">
          <Logo size={44} glow={!active} />
        </button>
        <span className={`dock-node dock-node-${nodeStatus}`} title={`Tu nodo: ${nodeStatus === 'online' ? 'en línea' : nodeStatus === 'connecting' ? 'conectando' : 'no responde'}`} />
      </div>
      <div className="dock-sep" />
      <div className="dock-list">
        {sessions.map((session) => (
          <ServerButton key={session.key} session={session} active={active === session.key} />
        ))}
      </div>
      <div className="dock-item">
        <button type="button" className="dock-add" onClick={() => openModal({ kind: 'join' })} aria-label="Unirme a un servidor" title="Unirme a un servidor">
          <Icon name="plus" size={20} />
        </button>
      </div>
      <div className="dock-spacer" />
      <button type="button" className="dock-settings" onClick={() => openModal({ kind: 'settings' })} aria-label="Ajustes" title="Ajustes">
        <Icon name="settings" size={18} />
      </button>
    </nav>
  );
}
