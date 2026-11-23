import type { Server } from '../api/schema';

type Props = {
  open: boolean;
  servers: Server[];
  selectedId: string | null;
  onSelect: (serverId: string) => void;
  onClose: () => void;
};

/** Mosaico de servidores disponibles para unirse (los que todavía no usaste). */
export function ServerPicker({ open, servers, selectedId, onSelect, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="gallery-backdrop" onClick={onClose} role="presentation">
      <section
        className="gallery"
        role="dialog"
        aria-modal="true"
        aria-label="Servidores nuevos"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gallery-header">
          <div>
            <h2>Servidores nuevos</h2>
            <p className="muted">{servers.length} disponibles en este nodo</p>
          </div>
          <button type="button" className="gallery-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="gallery-grid">
          {servers.map((server) => (
            <button
              key={server.id}
              type="button"
              className={`gallery-card ${server.id === selectedId ? 'is-current' : ''}`}
              onClick={() => {
                onSelect(server.id);
                onClose();
              }}
            >
              <span className="gallery-cover">{server.name.slice(0, 2).toUpperCase()}</span>
              <strong>{server.name}</strong>
              <span className="muted">/{server.slug}</span>
              <span className="gallery-status">{server.status}</span>
            </button>
          ))}
          {servers.length === 0 && (
            <p className="empty">No quedan servidores nuevos. Crea uno desde el inicio.</p>
          )}
        </div>
      </section>
    </div>
  );
}
