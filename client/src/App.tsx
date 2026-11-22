import { useEffect, useState } from 'react';
import { ChatView } from './components/ChatView';
import { ConnectPanel } from './components/ConnectPanel';
import { ServerRail } from './components/ServerRail';
import { ChannelList } from './components/ChannelList';
import { SessionBar } from './components/SessionBar';
import { Splash } from './components/Splash';
import { TitleBar } from './components/TitleBar';
import { useAppStore } from './state/store';
import { checkDependencies, type Dependency } from './state/deps';

const STATUS_LABEL: Record<string, string> = {
  idle: 'sin conexión',
  connecting: 'conectando…',
  open: 'en línea',
  reconnecting: 'reconectando…',
  closed: 'desconectado',
};

function MainLayout() {
  const status = useAppStore((state) => state.status);
  const selectedServerId = useAppStore((state) => state.selectedServerId);
  const servers = useAppStore((state) => state.servers);
  const session = useAppStore((state) => state.session);
  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const selectChannel = useAppStore((state) => state.selectChannel);
  const server = servers.find((item) => item.id === selectedServerId);
  const defaultChannel = server?.channels.find((channel) => channel.is_default) ?? server?.channels[0];

  return (
    <>
      <div className="layout">
        <ServerRail />
        <ChannelList />
        <main className="chat-pane">
          <header className="chat-header">
            <div>
              <strong>{server?.name ?? 'Hazel'}</strong>
              <span className="muted"> · conectado como {session?.member.display_name}</span>
            </div>
            <span className={`status status--${status}`}>{STATUS_LABEL[status] ?? status}</span>
          </header>
          <ChatView />
          {!defaultChannel && <p className="empty">Este servidor no tiene canales todavía.</p>}
          {defaultChannel && !selectedChannelId && (
            <button className="link" onClick={() => void selectChannel(defaultChannel.id)}>
              Entrar en #{defaultChannel.name}
            </button>
          )}
        </main>
      </div>
      <SessionBar />
    </>
  );
}

const SPLASH_MS = 1500;

export default function App() {
  const session = useAppStore((state) => state.session);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const init = useAppStore((state) => state.init);
  const [booting, setBooting] = useState(true);
  const [missing, setMissing] = useState<Dependency[] | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void checkDependencies().then(setMissing);
  }, []);

  useEffect(() => {
    if (missing === null || missing.length > 0) return;
    const timer = window.setTimeout(() => setBooting(false), SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, [missing]);

  if (booting) {
    return (
      <Splash
        missing={missing ?? []}
        checking={missing === null}
        onContinue={() => setBooting(false)}
      />
    );
  }

  return (
    <div className="app">
      <TitleBar />
      {error && (
        <div className="banner" role="alert" onClick={clearError}>
          {error} <span className="banner-close">×</span>
        </div>
      )}
      {session ? <MainLayout /> : <ConnectPanel />}
    </div>
  );
}
