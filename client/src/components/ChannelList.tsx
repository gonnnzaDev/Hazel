import { useAppStore } from '../state/store';

export function ChannelList() {
  const servers = useAppStore((state) => state.servers);
  const selectedServerId = useAppStore((state) => state.selectedServerId);
  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const selectChannel = useAppStore((state) => state.selectChannel);
  const presence = useAppStore((state) => state.presence);

  const server = servers.find((item) => item.id === selectedServerId);
  const online = Object.values(presence).filter(Boolean).length;

  return (
    <aside className="channels">
      <header className="channels-header">
        <strong>{server?.name ?? 'Servidor'}</strong>
        <span className="muted">{online} en línea</span>
      </header>
      <div className="channels-scroll">
        <p className="group-label">CANALES DE TEXTO</p>
        {server?.channels
          .filter((channel) => channel.kind === 'text')
          .map((channel) => (
            <button
              key={channel.id}
              className={`channel ${channel.id === selectedChannelId ? 'is-active' : ''}`}
              onClick={() => void selectChannel(channel.id)}
            >
              <span className="channel-hash">#</span> {channel.name}
            </button>
          ))}
        {server?.channels.some((channel) => channel.kind === 'voice') && (
          <>
            <p className="group-label">VOZ</p>
            {server.channels
              .filter((channel) => channel.kind === 'voice')
              .map((channel) => (
                <div key={channel.id} className="channel channel--voice">
                  <span>🔊</span> {channel.name}
                </div>
              ))}
          </>
        )}
      </div>
    </aside>
  );
}
