import { useEffect, useRef, useState } from 'react';
import { ChatView } from './components/ChatView';
import { ConnectPanel } from './components/ConnectPanel';
import { MainMenu } from './components/MainMenu';
import { NameEditor } from './components/NameEditor';
import { ServerSettings } from './components/ServerSettings';
import { Splash } from './components/Splash';
import { TitleBar } from './components/TitleBar';
import { useAppStore } from './state/store';
import {
  checkDependencies,
  installDependencies,
  onInstallProgress,
  onInstallProgressStep,
  type Dependency,
  type InstallProgress,
} from './state/deps';

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
  const canManage = useAppStore((state) => state.canManage);
  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const selectChannel = useAppStore((state) => state.selectChannel);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const server = servers.find((item) => item.id === selectedServerId);
  const defaultChannel = server?.channels.find((channel) => channel.is_default) ?? server?.channels[0];

  return (
    <>
      <div className="layout">
        <main className="chat-pane">
          <header className="chat-header">
            <div className="chat-header-left">
              <button
                type="button"
                className="header-menu-button"
                onClick={() => setMenuOpen(true)}
                aria-label="Abrir menú"
                title="Menú"
              >
                <span aria-hidden="true">☰</span>
              </button>
              <div>
                <strong>{server?.name ?? 'Hazel'}</strong>
                <span className="muted"> · conectado como </span>
                <button
                  type="button"
                  className="header-name-button"
                  onClick={() => setEditingName(true)}
                  title="Cambiar nombre"
                >
                  {session?.member.display_name} <span aria-hidden="true">✎</span>
                </button>
              </div>
            </div>
            <div className="chat-header-actions">
              {canManage && (
                <button type="button" className="header-ghost" onClick={() => setShowSettings(true)}>
                  <span aria-hidden="true">⚙</span> Ajustes
                </button>
              )}
              <span className={`status status--${status}`}>{STATUS_LABEL[status] ?? status}</span>
            </div>
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
      <MainMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <NameEditor open={editingName} onClose={() => setEditingName(false)} />
      <ServerSettings open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}

export default function App() {
  const session = useAppStore((state) => state.session);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const init = useAppStore((state) => state.init);
  const [booting, setBooting] = useState(true);
  const [missing, setMissing] = useState<Dependency[] | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installStep, setInstallStep] = useState<InstallProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const installStarted = useRef(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void checkDependencies()
      .then(setMissing)
      .catch((error: unknown) => {
        setInstallError(error instanceof Error ? error.message : String(error));
        setMissing([]);
      });
  }, []);

  // Si falta algo, se instala automáticamente sin que el usuario haga nada.
  useEffect(() => {
    if (missing === null || missing.length === 0 || installStarted.current) return;
    installStarted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenStep: (() => void) | undefined;

    void (async () => {
      unlisten = await onInstallProgress((line) => {
        if (!disposed) setInstallLog((log) => [...log, line]);
      });
      unlistenStep = await onInstallProgressStep((step) => {
        if (!disposed) setInstallStep(step);
      });
      try {
        await installDependencies();
        const remaining = await checkDependencies();
        if (!disposed) {
          setMissing(remaining);
          if (remaining.length === 0) {
            // Solo se entra al home con el 100 % de las dependencias.
            setBooting(false);
          } else {
            setInstallError(
              `Todavía faltan ${remaining.length} dependencias después de la instalación.`,
            );
          }
        }
      } catch (error) {
        if (!disposed) {
          setInstallError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        unlisten?.();
        unlistenStep?.();
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      unlistenStep?.();
    };
  }, [missing]);

  useEffect(() => {
    // Sin nada que instalar, el splash no retiene al usuario.
    if (missing !== null && missing.length === 0 && !installError) setBooting(false);
  }, [missing, installError]);

  // Si no falta nada, ni siquiera se muestra el splash: directo al home.
  if (booting && (missing === null || missing.length > 0 || installError !== null)) {
    return (
      <Splash
        missing={missing ?? []}
        checking={missing === null}
        installLog={installLog}
        installStep={installStep}
        installError={installError}
      />
    );
  }

  return (
    <div className={session ? 'app app--session' : 'app'}>
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
