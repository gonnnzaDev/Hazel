// La ventana entera: barra, dock y los paneles en mosaico, como un tiling WM.

import { useEffect } from 'react';

import { closeOverlays, currentKey, goHome, markCurrentRead, selectSession, toggleMute } from '../actions';
import { useApp } from '../store/app';
import { dmChannel } from '../store/chat';
import { getSession, useSessions } from '../store/sessions';
import { useSettings } from '../store/settings';
import { useVoice } from '../store/voice';
import { Background } from './Background';
import { Boot } from './Boot';
import { Chat, type ChatTarget } from './Chat';
import { Dock } from './Dock';
import { Home } from './Home';
import { Members } from './Members';
import { Modals } from './Modals';
import { MentionsPanel, Toasts } from './Overlays';
import { Sidebar } from './Sidebar';
import { Icon } from './ui';
import { Voice } from './Voice';
import { Waybar } from './Waybar';
import { Wofi } from './Wofi';

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useApp.setState((s) => ({ wofiOpen: !s.wofiOpen, mentionsOpen: false }));
      } else if (mod && /^[0-9]$/.test(event.key)) {
        event.preventDefault();
        const n = Number(event.key);
        if (n === 0) goHome();
        const session = useSessions.getState().sessions[n - 1];
        if (session) selectSession(session.key);
      } else if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        if (useVoice.getState().call) toggleMute();
      } else if (event.key === 'Escape') {
        const { modal, wofiOpen, mentionsOpen } = useApp.getState();
        if (modal || wofiOpen || mentionsOpen) closeOverlays();
      }
    };
    // En captura: así anda aunque el foco esté en un campo de texto.
    window.addEventListener('keydown', onKey, true);
    const onVisible = () => {
      if (!document.hidden) markCurrentRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

function Workspace() {
  const view = useApp((s) => s.view);
  const key = currentKey(view);
  const session = useSessions((s) => s.sessions.find((x) => x.key === key));
  const server = useApp((s) => (key ? s.servers[key] : undefined));
  const members = useApp((s) => (key ? s.members[key] : undefined));
  const showMembers = useSettings((s) => s.showMembers);

  if (view.kind === 'home' || !session) return <Home />;

  let main;
  if (view.kind === 'voice') {
    main = <Voice session={session} channelId={view.channelId} />;
  } else if (view.kind === 'dm') {
    const member = members?.find((m) => m.id === view.peerId);
    const target: ChatTarget = {
      session,
      channelId: dmChannel(session.member.id, view.peerId),
      title: member?.display_name ?? 'Mensaje directo',
      peer: { id: view.peerId, name: member?.display_name ?? 'Alguien', nick: member?.nickname ?? '' },
      readOnly: session.expired ? 'Tu sesión venció: volvé a entrar para escribir.' : undefined,
    };
    main = <Chat target={target} />;
  } else {
    const channel = server?.channels.find((c) => c.id === view.channelId);
    if (!server || !channel) {
      main = (
        <section className="panel glass center-note">
          <span className="spinner" /> cargando…
        </section>
      );
    } else {
      const readOnly = session.expired
        ? 'Tu sesión venció: volvé a entrar para escribir.'
        : server.status !== 'active'
          ? 'El servidor está apagado.'
          : undefined;
      main = <Chat target={{ session, channelId: channel.id, title: channel.name, subtitle: channel.topic ?? undefined, readOnly }} />;
    }
  }

  return (
    <div className="tiles">
      <Sidebar session={getSession(session.key) ?? session} />
      {main}
      {view.kind === 'channel' && showMembers ? <Members session={session} /> : null}
    </div>
  );
}

export function App() {
  useShortcuts();
  return (
    <>
      <Background />
      <div className="app">
        <Waybar />
        <div className="workspace">
          <Dock />
          <Workspace />
        </div>
      </div>
      <button type="button" className="fab" onClick={() => useApp.setState({ wofiOpen: true })} aria-label="Buscar (Ctrl+K)" title="Buscar (Ctrl+K)">
        <Icon name="command" size={20} />
      </button>
      <Wofi />
      <MentionsPanel />
      <Modals />
      <Toasts />
      <Boot />
    </>
  );
}
