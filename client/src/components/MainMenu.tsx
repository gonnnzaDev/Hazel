import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CallSocket } from '../api/ws';
import { useAppStore } from '../state/store';

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Menú único: canales, acceso a servidores y cerrar sesión. */
export function MainMenu({ open, onClose }: Props) {
  const joined = useAppStore((state) => state.joined);
  const servers = useAppStore((state) => state.servers);
  const selectedServerId = useAppStore((state) => state.selectedServerId);
  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const selectJoinedServer = useAppStore((state) => state.selectJoinedServer);
  const selectChannel = useAppStore((state) => state.selectChannel);
  const createChannel = useAppStore((state) => state.createChannel);
  const canManage = useAppStore((state) => state.canManage);
  const join = useAppStore((state) => state.join);
  const loadServers = useAppStore((state) => state.loadServers);
  const baseUrl = useAppStore((state) => state.baseUrl);
  const leaveServer = useAppStore((state) => state.leaveServer);
  const deleteServer = useAppStore((state) => state.deleteServer);
  const session = useAppStore((state) => state.session);
  const logout = useAppStore((state) => state.logout);
  const loadCallParticipants = useAppStore((state) => state.loadCallParticipants);
  const callParticipants = useAppStore((state) => state.callParticipants);
  const loading = useAppStore((state) => state.loading);
  const callRef = useRef<CallSocket | null>(null);
  const [view, setView] = useState<'main' | 'servers'>('main');
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinName, setJoinName] = useState('');
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelKind, setNewChannelKind] = useState<'text' | 'voice'>('text');
  const [callChannel, setCallChannel] = useState<string | null>(null);
  const [callSignal, setCallSignal] = useState('');

  useEffect(() => {
    if (open) void loadServers();
  }, [open, loadServers]);

  useEffect(() => {
    if (!open) {
      callRef.current?.close();
      callRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const server = servers.find((item) => item.id === selectedServerId);
  const textChannels = server?.channels.filter((channel) => channel.kind === 'text') ?? [];
  const voiceChannels = server?.channels.filter((channel) => channel.kind === 'voice') ?? [];

  // Los creados en este nodo pertenecen al host (dueño del nodo).
  const myServers = servers.map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
  }));

  // Servidores con token guardado. El activo siempre se incluye, aunque el
  // registro local esté desactualizado o vacío.
  const activeEntry =
    session && selectedServerId
      ? {
          server_id: selectedServerId,
          token: session.token,
          base_url: baseUrl,
          name: server?.name ?? 'Hazel',
          slug: server?.slug ?? 'hazel',
        }
      : null;
  const joinedEntries = [...joined];
  if (activeEntry && !joinedEntries.some((item) => item.server_id === activeEntry.server_id)) {
    joinedEntries.unshift(activeEntry);
  }
  const joinedServers = joinedEntries.map((entry) => ({
    entry,
    server: servers.find((item) => item.id === entry.server_id),
  }));

  const entryFor = (serverId: string) => joinedEntries.find((item) => item.server_id === serverId);

  function endCall() {
    callRef.current?.close();
    callRef.current = null;
    setCallChannel(null);
    setCallSignal('');
  }

  function startCall(channelId: string) {
    if (!session || !server) return;
    endCall();
    const call = new CallSocket((message) => setCallSignal(String(message.type ?? '')));
    call.connect(baseUrl, server.id, channelId, session.token);
    callRef.current = call;
    setCallChannel(channelId);
    void loadCallParticipants(channelId);
  }

  function submitChannel(event: FormEvent) {
    event.preventDefault();
    const name = newChannelName.trim();
    if (!name) return;
    void createChannel({ name, kind: newChannelKind, topic: null }).then((ok) => {
      if (!ok) return;
      setNewChannelName('');
      setNewChannelKind('text');
      setCreatingChannel(false);
    });
  }

  function submitJoin(event: FormEvent, serverId: string) {
    event.preventDefault();
    const name = joinName.trim();
    if (!name) return;
    void join(serverId, name).then(() => {
      setJoiningId(null);
      onClose();
    });
  }

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} role="presentation" />
      <aside className="main-menu" role="dialog" aria-modal="true" aria-label="Menú principal">
        <header className="menu-header">
          {view === 'servers' && (
            <button
              type="button"
              className="menu-back"
              onClick={() => setView('main')}
              aria-label="Volver al menú"
              title="Volver"
            >
              ←
            </button>
          )}
          <span className="menu-logo" aria-hidden="true">H</span>
          <div className="menu-header-text">
            <strong>{view === 'servers' ? 'Servidores' : server?.name ?? 'Hazel'}</strong>
            <span className="muted">
              {view === 'servers'
                ? `${joinedServers.length} en los que estás`
                : session?.member.display_name}
            </span>
          </div>
          <button type="button" className="menu-close" onClick={onClose} aria-label="Cerrar menú">
            ×
          </button>
        </header>

        <div className="menu-scroll">
          {view === 'main' ? (
            <>
              <section className="menu-section">
                <h2 className="menu-section-title">Canales</h2>
                {textChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    className={`channel ${channel.id === selectedChannelId ? 'is-active' : ''}`}
                    onClick={() => {
                      void selectChannel(channel.id);
                      onClose();
                    }}
                  >
                    <span className="channel-hash">#</span> {channel.name}
                  </button>
                ))}
                {voiceChannels.length > 0 && <p className="group-label">VOZ</p>}
                {voiceChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    className={`channel channel--voice ${callChannel === channel.id ? 'is-active' : ''}`}
                    onClick={() => startCall(channel.id)}
                  >
                    <span aria-hidden="true">🔊</span> {channel.name}
                  </button>
                ))}
                {textChannels.length === 0 && voiceChannels.length === 0 && (
                  <p className="menu-empty">Este servidor no tiene canales.</p>
                )}
                {canManage && !creatingChannel && (
                  <button
                    type="button"
                    className="menu-item menu-add-channel"
                    onClick={() => setCreatingChannel(true)}
                  >
                    <span aria-hidden="true">+</span>
                    <span className="menu-item-text"><strong>Nuevo canal</strong></span>
                  </button>
                )}
                {canManage && creatingChannel && (
                  <form className="menu-join menu-channel-create" onSubmit={submitChannel}>
                    <input
                      value={newChannelName}
                      onChange={(event) => setNewChannelName(event.target.value)}
                      placeholder="nombre del canal"
                      aria-label="Nombre del canal"
                      autoFocus
                    />
                    <select
                      value={newChannelKind}
                      onChange={(event) => setNewChannelKind(event.target.value as 'text' | 'voice')}
                      aria-label="Tipo de canal"
                    >
                      <option value="text">Texto</option>
                      <option value="voice">Voz</option>
                    </select>
                    <button type="submit" disabled={loading || !newChannelName.trim()}>Crear</button>
                    <button type="button" onClick={() => setCreatingChannel(false)}>No</button>
                  </form>
                )}
              </section>

              {callChannel && (
                <section className="menu-section">
                  <h2 className="menu-section-title">En llamada</h2>
                  {(callParticipants?.participants ?? []).map((participant) => (
                    <div key={participant.member_id} className="settings-row">
                      <span className="settings-row-name">{participant.display_name}</span>
                      <span className="muted">{participant.mic ? '🎤' : '🔇'} {participant.cam ? '📷' : '📷‍↔️'}</span>
                    </div>
                  ))}
                  {callSignal && <p className="menu-empty">Señal: {callSignal}</p>}
                  <div className="settings-actions">
                    <button type="button" onClick={() => callRef.current?.sendSignal('state', { mic: true })}>Mic</button>
                    <button type="button" className="header-ghost" onClick={() => callRef.current?.sendSignal('state', { cam: true })}>Cámara</button>
                    <button type="button" className="header-ghost danger" onClick={endCall}>Salir</button>
                  </div>
                </section>
              )}

              <section className="menu-section">
                <button type="button" className="menu-item" onClick={() => setView('servers')}>
                  <span aria-hidden="true">▦</span>
                  <span className="menu-item-text">
                    <strong>Servidores</strong>
                    <small className="muted">{joinedServers.length} en los que estás</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              </section>

              <section className="menu-section menu-section--last menu-section--logout">
                <button type="button" className="menu-item menu-logout" onClick={() => void logout()}>
                  <span aria-hidden="true">↩</span>
                  <span className="menu-item-text"><strong>Cerrar sesión</strong></span>
                </button>
              </section>
            </>
          ) : (
            <>
              <section className="menu-section">
                <h2 className="menu-section-title">Mis servidores · creados en mi nodo</h2>
                {myServers.map((item) => {
                  const entry = entryFor(item.id);
                  const active = item.id === selectedServerId;
                  return (
                    <div key={item.id}>
                      <div className="menu-joined-row">
                        <button
                          type="button"
                          className={`menu-item menu-server ${active ? 'is-active' : ''}`}
                          disabled={loading || joiningId === item.id}
                          onClick={() => {
                            if (entry) {
                              void selectJoinedServer(item.id);
                              onClose();
                            } else {
                              setJoinName(session?.member.display_name ?? '');
                              setJoiningId(item.id);
                            }
                          }}
                        >
                          <span className="menu-server-cover">{item.name.slice(0, 2).toUpperCase()}</span>
                          <span className="menu-item-text">
                            <strong>{item.name}</strong>
                            <small className="muted">
                              /{item.slug} · {active ? 'actual' : entry ? 'unido' : 'disponible'}
                            </small>
                          </span>
                        </button>
                        {confirmDeleteId === item.id ? (
                          <span className="menu-leave-confirm">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => {
                                void deleteServer(item.id);
                                setConfirmDeleteId(null);
                                onClose();
                              }}
                            >
                              Borrar
                            </button>
                            <button type="button" onClick={() => setConfirmDeleteId(null)}>No</button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="menu-server-remove menu-server-delete"
                            title={`Eliminar ${item.name}`}
                            aria-label={`Eliminar ${item.name}`}
                            onClick={() => setConfirmDeleteId(item.id)}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                      {joiningId === item.id && (
                        <form className="menu-join" onSubmit={(event) => submitJoin(event, item.id)}>
                          <input
                            value={joinName}
                            onChange={(event) => setJoinName(event.target.value)}
                            placeholder="Tu nombre"
                            aria-label="Nombre para unirse"
                            autoFocus
                          />
                          <button type="submit" disabled={loading || !joinName.trim()}>Unirse</button>
                        </form>
                      )}
                    </div>
                  );
                })}
                {myServers.length === 0 && (
                  <p className="menu-empty">Este nodo todavía no tiene servidores.</p>
                )}
              </section>

              <section className="menu-section menu-section--last">
                <h2 className="menu-section-title">En los que estoy</h2>
                {joinedServers.map(({ entry, server: live }) => {
                  const active = entry.server_id === selectedServerId;
                  const name = live?.name ?? entry.name;
                  return (
                    <div key={entry.server_id} className="menu-joined-row">
                      <button
                        type="button"
                        className={`menu-item menu-server ${active ? 'is-active' : ''}`}
                        disabled={loading}
                        onClick={() => {
                          void selectJoinedServer(entry.server_id);
                          onClose();
                        }}
                      >
                        <span className="menu-server-cover">{name.slice(0, 2).toUpperCase()}</span>
                        <span className="menu-item-text">
                          <strong>{name}</strong>
                          <small className="muted">
                            /{live?.slug ?? entry.slug} · {active ? 'actual' : 'unido'}
                          </small>
                        </span>
                      </button>
                      {confirmLeaveId === entry.server_id ? (
                        <span className="menu-leave-confirm">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => {
                              void leaveServer(entry.server_id);
                              setConfirmLeaveId(null);
                              onClose();
                            }}
                          >
                            Salir
                          </button>
                          <button type="button" onClick={() => setConfirmLeaveId(null)}>No</button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="menu-server-remove"
                          title={`Salir de ${name}`}
                          aria-label={`Salir de ${name}`}
                          onClick={() => setConfirmLeaveId(entry.server_id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
                {joinedServers.length === 0 && (
                  <p className="menu-empty">Todavía no te uniste a ningún servidor.</p>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
