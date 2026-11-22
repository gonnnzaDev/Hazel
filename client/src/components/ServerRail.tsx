import { useAppStore } from '../state/store';

export function ServerRail() {
  const servers = useAppStore((state) => state.servers);
  const selectedServerId = useAppStore((state) => state.selectedServerId);
  const loadServers = useAppStore((state) => state.loadServers);
  const logout = useAppStore((state) => state.logout);

  return (
    <nav className="rail" aria-label="Servidores">
      <div className="rail-logo">H</div>
      <div className="rail-divider" />
      {servers.map((server) => (
        <button
          key={server.id}
          className={`rail-server ${server.id === selectedServerId ? 'is-active' : ''}`}
          title={server.name}
          onClick={() => void loadServers()}
        >
          {server.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <div className="rail-spacer" />
      <button className="rail-server rail-server--exit" title="Salir" onClick={() => void logout()}>
        ↩
      </button>
    </nav>
  );
}
