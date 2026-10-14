// El panel del servidor: banner, canales por categoría (colapsables), quién
// está en cada canal de voz, tus mensajes directos y tu barra de usuario.

import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  confirmLeave,
  copyAddress,
  leaveVoice,
  openVoice,
  reenter,
  selectChannel,
  selectDm,
  toggleDeafen,
  toggleMute,
} from '../actions';
import { accentOf, alpha } from '../lib/color';
import { duration } from '../lib/format';
import type { Channel, Session } from '../lib/types';
import { openModal, useApp } from '../store/app';
import { dmPeer, isDm, unreadOf, useChat } from '../store/chat';
import { useSettings } from '../store/settings';
import { useVoice } from '../store/voice';
import { useNow } from './hooks';
import { Avatar, Badge, Icon, IconButton, PRESENCE_LABEL } from './ui';

function Category({ id, label, children, count }: { id: string; label: string; children: ReactNode; count?: number }) {
  const collapsed = useSettings((s) => Boolean(s.collapsed[id]));
  const toggle = useSettings((s) => s.toggleCollapsed);
  return (
    <section className={collapsed ? 'category collapsed' : 'category'}>
      <button type="button" className="category-head" onClick={() => toggle(id)} aria-expanded={!collapsed}>
        <Icon name="chevron-down" size={12} className="category-chevron" />
        <span>{label}</span>
        {count !== undefined ? <span className="category-count">{count}</span> : null}
      </button>
      <div className="category-body">{children}</div>
    </section>
  );
}

function TextChannelRow({ session, channel, active }: { session: Session; channel: Channel; active: boolean }) {
  const unread = useChat(useShallow((s) => unreadOf(s, session.key, channel.id, session.member.id, session.member.nickname)));
  const classes = ['channel-row', active ? 'active' : '', unread.count && !active ? 'unread' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} onClick={() => selectChannel(session.key, channel.id)} title={channel.topic ?? channel.name}>
      <Icon name="hash" size={16} />
      <span className="channel-name">{channel.name}</span>
      {!active ? <Badge count={unread.mentions} mention /> : null}
    </button>
  );
}

function VoiceChannelRow({ session, channel, active }: { session: Session; channel: Channel; active: boolean }) {
  const room = useApp((s) => s.voiceRooms[session.key]?.[channel.id]);
  const call = useVoice((s) => (s.call?.key === session.key && s.call.channelId === channel.id ? s.call : null));
  // Si estás adentro, la lista sale de la llamada (al instante); si no, de lo que informa el nodo.
  const people = call ? call.participants : (room ?? []);
  return (
    <div className="voice-channel">
      <button
        type="button"
        className={['channel-row', active ? 'active' : '', call ? 'connected' : ''].filter(Boolean).join(' ')}
        onClick={() => void openVoice(session.key, channel.id)}
        title={call ? 'Estás en este canal' : `Entrar a ${channel.name}`}
      >
        <Icon name="volume-2" size={16} />
        <span className="channel-name">{channel.name}</span>
        {people.length ? <span className="channel-count">{people.length}</span> : null}
      </button>
      {people.length ? (
        <div className="voice-occupants">
          {people.map((p) => (
            <div key={p.member_id} className="voice-occupant">
              <Avatar name={p.display_name} nick={p.nickname} size={22} speaking={Boolean(call?.speaking[p.member_id])} />
              <span className="voice-occupant-name">{p.display_name}</span>
              {!p.mic ? <Icon name="mic-off" size={12} className="muted-icon" /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DmRow({ session, peerId, active }: { session: Session; peerId: string; active: boolean }) {
  const channelId = useChat(
    (s) => Object.keys(s.messages[session.key] ?? {}).find((c) => isDm(c) && dmPeer(c, session.member.id) === peerId) ?? '',
  );
  const unread = useChat(useShallow((s) => unreadOf(s, session.key, channelId, session.member.id, session.member.nickname)));
  const last = useChat((s) => {
    const list = s.messages[session.key]?.[channelId];
    return list?.[list.length - 1];
  });
  const member = useApp((s) => s.members[session.key]?.find((m) => m.id === peerId));
  const presence = useChat((s) => s.presence[session.key]?.[peerId]);
  const name = member?.display_name ?? (last?.authorId === peerId ? last.name : 'Alguien');
  const nick = member?.nickname ?? (last?.authorId === peerId ? last.nick : peerId);
  return (
    <button type="button" className={active ? 'channel-row dm-row active' : 'channel-row dm-row'} onClick={() => selectDm(session.key, peerId)}>
      <Avatar name={name} nick={nick} size={24} presence={presence?.online ? presence.presence : 'offline'} />
      <span className="channel-name">{name}</span>
      {!active ? <Badge count={unread.count} mention /> : null}
    </button>
  );
}

function ServerBanner({ session }: { session: Session }) {
  const server = useApp((s) => s.servers[session.key]);
  const members = useApp((s) => s.members[session.key]);
  const online = useChat((s) => Object.values(s.presence[session.key] ?? {}).filter((p) => p.online).length);
  const bus = useChat((s) => s.bus[session.key]);
  const accent = accentOf(session.serverId);
  const status =
    session.expired
      ? 'sesión vencida'
      : server?.status === 'inactive'
        ? 'apagado'
        : bus?.status === 'online'
          ? `${online} en línea`
          : bus?.status === 'connecting'
            ? 'conectando…'
            : 'sin conexión';

  return (
    <div className="server-banner" style={{ borderColor: alpha(accent, 0.35) }}>
      <div
        className="server-banner-art"
        style={{ background: `linear-gradient(120deg, ${alpha(accent, 0.55)}, ${alpha('#A855F7', 0.35)} 60%, ${alpha('#0a0e14', 0.2)})` }}
      >
        <div className="server-banner-actions">
          <IconButton icon="copy" label="Copiar dirección para invitar" size={14} onClick={() => server && void copyAddress(session.baseUrl, server)} />
          <IconButton icon="log-out" label="Salir del servidor" size={14} onClick={() => confirmLeave(session.key)} />
        </div>
      </div>
      <div className="server-banner-body">
        <div className="server-name" title={session.name}>
          {session.name}
        </div>
        {server?.description ? <div className="server-desc">{server.description}</div> : null}
        <div className="server-meta">
          <span className={`status-dot ${bus?.status === 'online' ? 'on' : ''}`} style={bus?.status === 'online' ? { background: accent, boxShadow: `0 0 8px ${accent}` } : undefined} />
          <span>{status}</span>
          <span className="dim">· {members?.length ?? '…'} miembros</span>
          <span className="dim mono">/{session.slug}</span>
        </div>
      </div>
    </div>
  );
}

function VoicePanel() {
  const call = useVoice((s) => s.call);
  const now = useNow(1000);
  if (!call) return null;
  return (
    <div className="voice-panel">
      <div className="voice-panel-info">
        <span className={call.state === 'connected' ? 'voice-panel-state ok' : 'voice-panel-state'}>
          <Icon name="radio" size={12} />
          {call.state === 'connected' ? 'voz conectada' : 'conectando…'}
        </span>
        <span className="voice-panel-where" title={`${call.channelName} · ${call.serverName}`}>
          {call.channelName} · {call.serverName}
        </span>
      </div>
      <span className="voice-panel-time mono">{call.state === 'connected' ? duration(call.joinedAt, now) : '--:--'}</span>
      <IconButton icon="phone-off" label="Salir de la llamada" danger onClick={leaveVoice} />
    </div>
  );
}

export function UserBar({ session }: { session: Session | null }) {
  const { presence, statusText } = useSettings(useShallow((s) => ({ presence: s.presence, statusText: s.statusText })));
  const call = useVoice((s) => s.call);
  const lastNickname = useSettings((s) => s.lastNickname);
  const nick = session?.member.nickname || lastNickname || 'vos';
  const name = session?.member.display_name || nick;
  return (
    <div className="user-bar">
      <button type="button" className="user-bar-me" onClick={() => openModal({ kind: 'status', key: session?.key })} title="Tu estado">
        <Avatar name={name} nick={nick} size={34} presence={presence} />
        <span className="user-bar-text">
          <span className="user-bar-name">{name}</span>
          <span className="user-bar-status">{statusText || PRESENCE_LABEL[presence]}</span>
        </span>
      </button>
      <IconButton
        icon={call?.muted || call?.deafened ? 'mic-off' : 'mic'}
        label={call ? (call.muted ? 'Activar micrófono' : 'Silenciar') : 'Micrófono (entrá a un canal de voz)'}
        active={Boolean(call?.muted || call?.deafened)}
        danger={Boolean(call?.muted || call?.deafened)}
        disabled={!call}
        onClick={toggleMute}
      />
      <IconButton
        icon={call?.deafened ? 'volume-x' : 'headphones'}
        label={call ? (call.deafened ? 'Escuchar' : 'Ensordecer') : 'Auriculares (entrá a un canal de voz)'}
        active={Boolean(call?.deafened)}
        danger={Boolean(call?.deafened)}
        disabled={!call}
        onClick={toggleDeafen}
      />
      <IconButton icon="settings" label="Ajustes" onClick={() => openModal({ kind: 'settings' })} />
    </div>
  );
}

export function Sidebar({ session }: { session: Session }) {
  const server = useApp((s) => s.servers[session.key]);
  const unreachable = useApp((s) => s.unreachable[session.key]);
  const view = useApp((s) => s.view);
  const members = useApp((s) => s.members[session.key]);
  const dmPeers = useChat(
    useShallow((s) =>
      Object.entries(s.messages[session.key] ?? {})
        .filter(([c, list]) => isDm(c) && list.length)
        .sort(([, a], [, b]) => (b[b.length - 1]?.createdAt ?? 0) - (a[a.length - 1]?.createdAt ?? 0))
        .map(([c]) => dmPeer(c, session.member.id)),
    ),
  );
  const openDmPeer = view.kind === 'dm' && view.key === session.key ? view.peerId : null;
  const peers = openDmPeer && !dmPeers.includes(openDmPeer) ? [openDmPeer, ...dmPeers] : dmPeers;

  const channels = [...(server?.channels ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const text = channels.filter((c) => c.kind === 'text');
  const voice = channels.filter((c) => c.kind === 'voice');
  const activeChannel = view.kind === 'channel' || view.kind === 'voice' ? view.channelId : null;

  return (
    <aside className="sidebar glass" aria-label={session.name}>
      <ServerBanner session={session} />
      {session.expired ? (
        <div className="sidebar-alert">
          <Icon name="alert-triangle" size={16} />
          <span>Tu sesión venció.</span>
          <button type="button" className="link" onClick={() => reenter(session.key)}>
            Volver a entrar
          </button>
        </div>
      ) : unreachable ? (
        <div className="sidebar-alert">
          <Icon name="wifi-off" size={16} />
          <span>{unreachable}</span>
        </div>
      ) : server?.status === 'inactive' ? (
        <div className="sidebar-alert">
          <Icon name="power" size={16} />
          <span>El servidor está apagado. Lo enciende su dueño desde su nodo.</span>
        </div>
      ) : null}

      <div className="sidebar-scroll">
        {!server ? (
          <div className="sidebar-loading">
            <span className="spinner" /> cargando canales…
          </div>
        ) : (
          <>
            <Category id={`${session.key}:text`} label="canales de texto" count={text.length}>
              {text.map((c) => (
                <TextChannelRow key={c.id} session={session} channel={c} active={activeChannel === c.id && view.kind === 'channel'} />
              ))}
            </Category>
            {voice.length ? (
              <Category id={`${session.key}:voice`} label="canales de voz" count={voice.length}>
                {voice.map((c) => (
                  <VoiceChannelRow key={c.id} session={session} channel={c} active={activeChannel === c.id && view.kind === 'voice'} />
                ))}
              </Category>
            ) : null}
            <Category id={`${session.key}:dm`} label="mensajes directos" count={peers.length}>
              {peers.length ? (
                peers.map((peerId) => <DmRow key={peerId} session={session} peerId={peerId} active={openDmPeer === peerId} />)
              ) : (
                <p className="sidebar-empty">
                  Tocá a alguien en la lista de miembros para escribirle por privado.
                  {members && members.length <= 1 ? ' Por ahora estás solo: invitá gente con el botón de copiar dirección.' : ''}
                </p>
              )}
            </Category>
          </>
        )}
      </div>
      <VoicePanel />
      <UserBar session={session} />
    </aside>
  );
}

