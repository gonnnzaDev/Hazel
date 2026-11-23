import { useEffect, useState, type FormEvent } from 'react';
import type { Backup, Channel, Invite } from '../api/schema';
import { useAppStore } from '../state/store';

type Props = { open: boolean; onClose: () => void };
type Tab = 'general' | 'channels' | 'invites' | 'members' | 'status' | 'data';

const invitesKey = (serverId: string) => `hazel.invites.${serverId}`;

function loadInvites(serverId: string): Invite[] {
  try {
    const raw = localStorage.getItem(invitesKey(serverId));
    return raw ? (JSON.parse(raw) as Invite[]) : [];
  } catch {
    return [];
  }
}

export function ServerSettings({ open, onClose }: Props) {
  const server = useAppStore((state) =>
    state.servers.find((item) => item.id === state.selectedServerId),
  );
  const canManage = useAppStore((state) => state.canManage);
  const updateServer = useAppStore((state) => state.updateServer);
  const setServerStatus = useAppStore((state) => state.setServerStatus);
  const createChannel = useAppStore((state) => state.createChannel);
  const updateChannel = useAppStore((state) => state.updateChannel);
  const deleteChannel = useAppStore((state) => state.deleteChannel);
  const createInvite = useAppStore((state) => state.createInvite);
  const deleteInvite = useAppStore((state) => state.deleteInvite);
  const members = useAppStore((state) => state.members);
  const stats = useAppStore((state) => state.stats);
  const events = useAppStore((state) => state.events);
  const serverAddress = useAppStore((state) => state.serverAddress);
  const loadMembers = useAppStore((state) => state.loadMembers);
  const kickMember = useAppStore((state) => state.kickMember);
  const loadServerInfo = useAppStore((state) => state.loadServerInfo);
  const createBackup = useAppStore((state) => state.createBackup);
  const restoreBackup = useAppStore((state) => state.restoreBackup);
  const refreshSession = useAppStore((state) => state.refreshSession);
  const logoutAll = useAppStore((state) => state.logoutAll);
  const sendHeartbeat = useAppStore((state) => state.sendHeartbeat);

  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState(50);
  const [newChannel, setNewChannel] = useState({ name: '', kind: 'text' as 'text' | 'voice', topic: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({ name: '', topic: '', position: 0 });
  const [ttl, setTtl] = useState(86400);
  const [singleUse, setSingleUse] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [lastBackup, setLastBackup] = useState<Backup | null>(null);

  useEffect(() => {
    if (!open || !server || !canManage) return;
    void loadMembers();
    void loadServerInfo();
  }, [open, server, canManage, loadMembers, loadServerInfo]);

  useEffect(() => {
    if (!open || !server) return;
    setName(server.name);
    setDescription(server.description ?? '');
    setMaxMembers(server.max_members);
    setInvites(loadInvites(server.id));
    setTab('general');
    setEditing(null);
  }, [open, server]);

  if (!open || !server || !canManage) return null;

  const persistInvites = (list: Invite[]) => {
    setInvites(list);
    localStorage.setItem(invitesKey(server.id), JSON.stringify(list));
  };

  async function handleGeneral(event: FormEvent) {
    event.preventDefault();
    const ok = await updateServer({
      name: name.trim(),
      description: description.trim() || null,
      max_members: maxMembers,
    });
    if (ok) onClose();
  }

  async function handleCreateChannel(event: FormEvent) {
    event.preventDefault();
    if (!newChannel.name.trim()) return;
    const ok = await createChannel({
      name: newChannel.name.trim(),
      kind: newChannel.kind,
      topic: newChannel.topic.trim() || null,
    });
    if (ok) setNewChannel({ name: '', kind: 'text', topic: '' });
  }

  function startEdit(channel: Channel) {
    setEditing(channel.id);
    setEditFields({ name: channel.name, topic: channel.topic ?? '', position: channel.position });
  }

  async function handleEditChannel(event: FormEvent, channelId: string) {
    event.preventDefault();
    const ok = await updateChannel(channelId, {
      name: editFields.name.trim(),
      topic: editFields.topic.trim() || null,
      position: editFields.position,
    });
    if (ok) setEditing(null);
  }

  async function handleCreateInvite(event: FormEvent) {
    event.preventDefault();
    const invite = await createInvite({ ttl_seconds: ttl, single_use: singleUse });
    if (invite) persistInvites([invite, ...invites]);
  }

  return (
    <div className="gallery-backdrop" onClick={onClose} role="presentation">
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Ajustes del servidor"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gallery-header">
          <div>
            <h2>Ajustes de {server.name}</h2>
            <p className="muted">Solo la máquina anfitriona</p>
          </div>
          <button type="button" className="gallery-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <nav className="settings-tabs">
          <button type="button" className={tab === 'general' ? 'is-active' : ''} onClick={() => setTab('general')}>General</button>
          <button type="button" className={tab === 'channels' ? 'is-active' : ''} onClick={() => setTab('channels')}>Canales</button>
          <button type="button" className={tab === 'invites' ? 'is-active' : ''} onClick={() => setTab('invites')}>Invitaciones</button>
          <button type="button" className={tab === 'members' ? 'is-active' : ''} onClick={() => setTab('members')}>Miembros</button>
          <button type="button" className={tab === 'status' ? 'is-active' : ''} onClick={() => setTab('status')}>Estado</button>
          <button type="button" className={tab === 'data' ? 'is-active' : ''} onClick={() => setTab('data')}>Datos</button>
        </nav>

        <div className="settings-body">
          {tab === 'general' && (
            <form className="settings-form" onSubmit={(event) => void handleGeneral(event)}>
              <label>
                Nombre del servidor
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={64} />
              </label>
              <label>
                Descripción
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} />
              </label>
              <label>
                Máximo de miembros
                <input type="number" value={maxMembers} min={1} max={10000} onChange={(event) => setMaxMembers(Number(event.target.value))} />
              </label>
              <div className="settings-actions">
                <button type="button" className="header-ghost" onClick={() => void setServerStatus(server.status !== 'active')}>
                  {server.status === 'active' ? 'Apagar servidor' : 'Activar servidor'}
                </button>
                <button type="submit">Guardar cambios</button>
              </div>
            </form>
          )}

          {tab === 'channels' && (
            <div className="settings-form">
              <p className="group-label">CANALES DE TEXTO</p>
              {server.channels.filter((channel) => channel.kind === 'text').map((channel) => (
                <div key={channel.id} className="settings-row">
                  {editing === channel.id ? (
                    <form className="settings-row-edit" onSubmit={(event) => void handleEditChannel(event, channel.id)}>
                      <input value={editFields.name} onChange={(event) => setEditFields({ ...editFields, name: event.target.value })} />
                      <input value={editFields.topic} placeholder="Tema" onChange={(event) => setEditFields({ ...editFields, topic: event.target.value })} />
                      <input type="number" value={editFields.position} onChange={(event) => setEditFields({ ...editFields, position: Number(event.target.value) })} />
                      <button type="submit">Guardar</button>
                      <button type="button" className="header-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                    </form>
                  ) : (
                    <>
                      <span className="settings-row-name">#{channel.name} {channel.is_default && <small>(principal)</small>}</span>
                      <span className="muted">{channel.topic ?? 'sin tema'}</span>
                      <button type="button" className="header-ghost" onClick={() => startEdit(channel)}>Editar</button>
                      {!channel.is_default && (
                        <button type="button" className="header-ghost danger" onClick={() => void deleteChannel(channel.id)}>Eliminar</button>
                      )}
                    </>
                  )}
                </div>
              ))}

              <p className="group-label">CANALES DE LLAMADA</p>
              {server.channels.filter((channel) => channel.kind === 'voice').map((channel) => (
                <div key={channel.id} className="settings-row">
                  {editing === channel.id ? (
                    <form className="settings-row-edit" onSubmit={(event) => void handleEditChannel(event, channel.id)}>
                      <input value={editFields.name} onChange={(event) => setEditFields({ ...editFields, name: event.target.value })} />
                      <input value={editFields.topic} placeholder="Tema" onChange={(event) => setEditFields({ ...editFields, topic: event.target.value })} />
                      <input type="number" value={editFields.position} onChange={(event) => setEditFields({ ...editFields, position: Number(event.target.value) })} />
                      <button type="submit">Guardar</button>
                      <button type="button" className="header-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                    </form>
                  ) : (
                    <>
                      <span className="settings-row-name">🔊 {channel.name}</span>
                      <span className="muted">{channel.topic ?? 'sin tema'}</span>
                      <button type="button" className="header-ghost" onClick={() => startEdit(channel)}>Editar</button>
                      <button type="button" className="header-ghost danger" onClick={() => void deleteChannel(channel.id)}>Eliminar</button>
                    </>
                  )}
                </div>
              ))}

              <form className="settings-create" onSubmit={(event) => void handleCreateChannel(event)}>
                <p className="group-label">NUEVO CANAL</p>
                <input value={newChannel.name} onChange={(event) => setNewChannel({ ...newChannel, name: event.target.value })} placeholder="nombre" />
                <select value={newChannel.kind} onChange={(event) => setNewChannel({ ...newChannel, kind: event.target.value as 'text' | 'voice' })}>
                  <option value="text">Texto</option>
                  <option value="voice">Llamada</option>
                </select>
                <input value={newChannel.topic} onChange={(event) => setNewChannel({ ...newChannel, topic: event.target.value })} placeholder="Tema (opcional)" />
                <button type="submit" disabled={!newChannel.name.trim()}>Crear canal</button>
              </form>
            </div>
          )}

          {tab === 'invites' && (
            <div className="settings-form">
              <form className="settings-create" onSubmit={(event) => void handleCreateInvite(event)}>
                <label>
                  Duración
                  <select value={ttl} onChange={(event) => setTtl(Number(event.target.value))}>
                    <option value={3600}>1 hora</option>
                    <option value={86400}>1 día</option>
                    <option value={604800}>7 días</option>
                    <option value={2592000}>30 días</option>
                  </select>
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={singleUse} onChange={(event) => setSingleUse(event.target.checked)} />
                  Un solo uso
                </label>
                <button type="submit">Crear invitación</button>
              </form>

              <p className="group-label">INVITACIONES CREADAS</p>
              {invites.map((invite) => (
                <div key={invite.code} className="settings-row">
                  <code>{invite.code}</code>
                  <span className="muted">{invite.single_use ? 'un uso' : 'multiuso'} · {invite.consumed ? 'usada' : 'activa'}</span>
                  <button
                    type="button"
                    className="header-ghost"
                    onClick={() => void navigator.clipboard?.writeText(invite.code)}
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    className="header-ghost danger"
                    onClick={() => {
                      void deleteInvite(invite.code).then((ok) => {
                        if (ok) persistInvites(invites.filter((item) => item.code !== invite.code));
                      });
                    }}
                  >
                    Revocar
                  </button>
                </div>
              ))}
              {invites.length === 0 && <p className="empty">Todavía no creaste invitaciones.</p>}
            </div>
          )}

          {tab === 'members' && (
            <div className="settings-form">
              <p className="group-label">MIEMBROS DEL SERVIDOR</p>
              {members.map((member) => (
                <div key={member.id} className="settings-row">
                  <span className="settings-row-name">{member.display_name}</span>
                  <span className="muted">/{member.nickname} · {member.role}</span>
                  <button
                    type="button"
                    className="header-ghost danger"
                    onClick={() => void kickMember(member.nickname)}
                  >
                    Expulsar
                  </button>
                </div>
              ))}
              {members.length === 0 && <p className="empty">No hay miembros.</p>}
            </div>
          )}

          {tab === 'status' && (
            <div className="settings-form">
              <p className="group-label">ESTADÍSTICAS</p>
              <div className="settings-row">
                <span className="settings-row-name">Miembros</span><span className="muted">{stats?.members ?? '—'}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-name">Mensajes</span><span className="muted">{stats?.messages ?? '—'}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-name">Adjuntos</span><span className="muted">{stats?.attachment_bytes ?? '—'} bytes</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-name">Total</span><span className="muted">{stats?.total_bytes ?? '—'} bytes</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-name">Dirección</span>
                <code>{serverAddress?.address ?? '—'}</code>
                <button
                  type="button"
                  className="header-ghost"
                  onClick={() => void navigator.clipboard?.writeText(serverAddress?.address ?? '')}
                >
                  Copiar
                </button>
              </div>
              <button type="button" onClick={() => void sendHeartbeat()}>Enviar heartbeat</button>
              <p className="group-label">AUDITORÍA</p>
              {(events?.items ?? []).map((event) => (
                <div key={event.id} className="settings-row">
                  <span className="settings-row-name">{event.action}</span>
                  <span className="muted">{event.actor_nickname ?? 'sistema'} · {event.created_at}</span>
                </div>
              ))}
              {!events?.items.length && <p className="empty">Sin eventos de auditoría.</p>}
            </div>
          )}

          {tab === 'data' && (
            <div className="settings-form">
              <p className="group-label">RESPALDOS</p>
              <div className="settings-actions">
                <button type="button" onClick={() => void createBackup().then(setLastBackup)}>Crear respaldo</button>
                <button type="button" className="header-ghost" onClick={() => void loadServerInfo()}>Actualizar</button>
              </div>
              {lastBackup && (
                <div className="settings-row">
                  <code>{lastBackup.backup_id}</code>
                  <span className="muted">{lastBackup.size} bytes</span>
                  <button type="button" className="header-ghost" onClick={() => void restoreBackup(lastBackup.backup_id)}>
                    Restaurar
                  </button>
                </div>
              )}
              {(events?.items ?? [])
                .filter((event) => event.action.startsWith('backup.'))
                .map((event) => {
                  const id = String(event.data.backup_id ?? event.target_id ?? '');
                  return id ? (
                    <div key={event.id} className="settings-row">
                      <code>{id}</code>
                      <span className="muted">{event.action}</span>
                      <button type="button" className="header-ghost" onClick={() => void restoreBackup(id)}>Restaurar</button>
                    </div>
                  ) : null;
                })}
              <p className="group-label">SESIÓN</p>
              <div className="settings-actions">
                <button type="button" onClick={() => void refreshSession()}>Renovar token</button>
                <button type="button" className="header-ghost danger" onClick={() => void logoutAll()}>Cerrar todas las sesiones</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
