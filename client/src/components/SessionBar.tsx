import { useAppStore } from '../state/store';

const LABEL: Record<string, string> = {
  idle: 'Sin conexión',
  connecting: 'Conectando…',
  open: 'En directo',
  reconnecting: 'Reconectando…',
  closed: 'Desconectado',
};

function portFromUrl(url: string): string {
  const match = url.match(/:(\d+)\/?$/);
  return match?.[1] ?? '—';
}

/** Barra inferior de sesión, inspirada en la barra de reproducción de un reproductor. */
export function SessionBar() {
  const status = useAppStore((state) => state.status);
  const session = useAppStore((state) => state.session);
  const servers = useAppStore((state) => state.servers);
  const selectedServerId = useAppStore((state) => state.selectedServerId);
  const baseUrl = useAppStore((state) => state.baseUrl);
  const address = useAppStore((state) => state.address);

  const server = servers.find((item) => item.id === selectedServerId);
  const name = session?.member.display_name ?? 'Invitado';

  return (
    <footer className="session-bar">
      <span className="session-track" />
      <div className="session-now">
        <div className="session-cover">H</div>
        <div className="session-now-text">
          <strong>{server?.name ?? 'Hazel'}</strong>
          <span className="muted">{server?.slug ?? 'sin servidor'}</span>
        </div>
      </div>

      <div className={`session-live session-live--${status}`}>
        <span className="pulse" />
        {LABEL[status] ?? status}
      </div>

      <div className="session-meta">
        <span className="session-port">:{address?.port ?? portFromUrl(baseUrl)}</span>
        <span className="session-name">{name}</span>
        <span className="session-avatar">{name.slice(0, 1).toUpperCase()}</span>
      </div>
    </footer>
  );
}
