// Los diálogos: crear y unirse a servidores, entrar con un nickname, tu
// estado, el perfil de alguien, ajustes y confirmaciones.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  changeNodeUrl,
  confirmKick,
  confirmLeave,
  createServer,
  enterServer,
  joinByAddress,
  renameMe,
  selectDm,
  setMemberRole,
  setStatus,
  slugify,
  VERSION,
} from '../actions';
import { asApiError } from '../lib/api';
import type { Presence } from '../lib/types';
import { closeModal, useApp, type Modal } from '../store/app';
import { useChat } from '../store/chat';
import { getSession } from '../store/sessions';
import { useSettings } from '../store/settings';
import { Avatar, Button, Field, Icon, IconButton, PRESENCE_LABEL, RoleBadge, ROLE_LABEL } from './ui';

function Shell({ title, subtitle, children, wide = false }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
      <div className={wide ? 'modal glass-strong wide' : 'modal glass-strong'} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>
              <span className="prompt">❯</span> {title}
            </h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="Cerrar" onClick={closeModal} />
        </header>
        {children}
      </div>
    </div>
  );
}

/** Corre una acción del formulario mostrando "cargando" y el error si falla. */
function useSubmit(action: () => Promise<void>): { busy: boolean; error: string | null; submit: (event?: FormEvent) => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    submit: (event) => {
      event?.preventDefault();
      setBusy(true);
      setError(null);
      action()
        .then(() => closeModal())
        .catch((e: unknown) => setError(asApiError(e).message))
        .finally(() => setBusy(false));
    },
  };
}

const NICK_HINT = 'De 2 a 32: minúsculas, números, punto, guion y guion bajo. Es tu identidad en ese servidor.';

function CreateModal() {
  const lastNickname = useSettings((s) => s.lastNickname);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState(lastNickname);
  const [description, setDescription] = useState('');
  const { busy, error, submit } = useSubmit(() => createServer({ name, nickname, description }));
  return (
    <Shell title="crear servidor" subtitle="Queda en tu compu. Después le pasás la dirección a quien quieras.">
      <form className="modal-body" onSubmit={submit}>
        <Field label="nombre" icon="server" placeholder="Casa de Luis" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={64} hint={name ? <>Dirección: <span className="mono">…/{slugify(name)}</span></> : 'Cómo lo ve todo el mundo.'} />
        <Field label="tu nickname ahí" icon="at-sign" placeholder="luis" value={nickname} onChange={(e) => setNickname(e.target.value)} hint={NICK_HINT} />
        <Field label="descripción (opcional)" icon="edit-2" placeholder="De qué se trata" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        {error ? <p className="form-error">{error}</p> : null}
        <p className="form-note">
          <Icon name="hash" size={12} /> Arranca con un canal de texto <strong>#general</strong> y uno de voz <strong>Charla</strong>.
        </p>
        <div className="modal-actions">
          <Button tone="ghost" onClick={closeModal}>
            Cancelar
          </Button>
          <Button tone="lime" solid icon="zap" type="submit" loading={busy} disabled={name.trim().length < 2 || nickname.trim().length < 2}>
            Desplegar servidor
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function JoinModal({ address: initial }: { address?: string }) {
  const lastNickname = useSettings((s) => s.lastNickname);
  const [address, setAddress] = useState(initial ?? '');
  const [nickname, setNickname] = useState(lastNickname);
  const [displayName, setDisplayName] = useState('');
  const { busy, error, submit } = useSubmit(() => joinByAddress(address, nickname, displayName));
  return (
    <Shell title="unirme a un servidor" subtitle="Pegá la dirección que te pasaron. Solo hace falta un nickname: no hay cuentas.">
      <form className="modal-body" onSubmit={submit}>
        <Field label="dirección" icon="link" placeholder="192.168.1.50:7272/casa-de-luis" value={address} onChange={(e) => setAddress(e.target.value)} autoFocus />
        <Field label="tu nickname" icon="at-sign" placeholder="ana_paula" value={nickname} onChange={(e) => setNickname(e.target.value)} hint={`${NICK_HINT} Si ya lo usaste ahí, lo recuperás.`} />
        <Field label="nombre visible (opcional)" icon="user" placeholder="Ana Paula" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} />
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <Button tone="ghost" onClick={closeModal}>
            Cancelar
          </Button>
          <Button tone="cyan" solid icon="log-in" type="submit" loading={busy} disabled={!address.trim() || nickname.trim().length < 2}>
            Entrar
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function EnterModal({ modal }: { modal: Extract<Modal, { kind: 'enter' }> }) {
  const lastNickname = useSettings((s) => s.lastNickname);
  const existing = getSession(`${modal.baseUrl}|${modal.serverId}`);
  const [nickname, setNickname] = useState(existing?.member.nickname ?? lastNickname);
  const { busy, error, submit } = useSubmit(() => enterServer(modal.baseUrl, modal.serverId, nickname));
  return (
    <Shell title={`entrar a ${modal.serverName}`} subtitle={existing ? 'Tu sesión venció: entrá de nuevo con tu nickname.' : 'Elegí con qué nickname entrás. Si sos quien lo creó, usá el nickname que pusiste al crearlo.'}>
      <form className="modal-body" onSubmit={submit}>
        <Field label="nickname" icon="at-sign" placeholder="luis" value={nickname} onChange={(e) => setNickname(e.target.value)} autoFocus hint={NICK_HINT} />
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <Button tone="ghost" onClick={closeModal}>
            Cancelar
          </Button>
          <Button tone="cyan" solid icon="log-in" type="submit" loading={busy} disabled={nickname.trim().length < 2}>
            Entrar
          </Button>
        </div>
      </form>
    </Shell>
  );
}

const PRESENCES: { value: Presence; icon: 'circle' | 'moon' | 'minus-circle' }[] = [
  { value: 'online', icon: 'circle' },
  { value: 'idle', icon: 'moon' },
  { value: 'dnd', icon: 'minus-circle' },
];

function StatusModal({ sessionKey }: { sessionKey?: string }) {
  const settings = useSettings();
  const session = getSession(sessionKey);
  const [presence, setPresence] = useState<Presence>(settings.presence);
  const [text, setText] = useState(settings.statusText);
  const [name, setName] = useState(session?.member.display_name ?? '');
  const { busy, error, submit } = useSubmit(async () => {
    setStatus(presence, text);
    if (session && name.trim() && name.trim() !== session.member.display_name) await renameMe(session.key, name);
  });
  return (
    <Shell title="tu estado" subtitle="Se ve en todos los servidores donde estés conectado.">
      <form className="modal-body" onSubmit={submit}>
        <div className="presence-picker" role="radiogroup" aria-label="Presencia">
          {PRESENCES.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={presence === p.value} className={presence === p.value ? `presence-option active p-${p.value}` : `presence-option p-${p.value}`} onClick={() => setPresence(p.value)}>
              <span className={`presence presence-${p.value}`} />
              {PRESENCE_LABEL[p.value]}
            </button>
          ))}
        </div>
        <Field label="estado personalizado" icon="message-circle" placeholder="Compilando el kernel otra vez" value={text} onChange={(e) => setText(e.target.value)} maxLength={128} />
        {session ? (
          <Field label={`nombre visible en ${session.name}`} icon="user" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} hint={`Tu nickname @${session.member.nickname} no cambia.`} />
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <Button tone="ghost" onClick={closeModal}>
            Cancelar
          </Button>
          <Button tone="purple" solid icon="check" type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function ProfileModal({ sessionKey, memberId }: { sessionKey: string; memberId: string }) {
  const session = getSession(sessionKey);
  const member = useApp((s) => s.members[sessionKey]?.find((m) => m.id === memberId));
  const presence = useChat((s) => s.presence[sessionKey]?.[memberId]);
  const fallback = useChat((s) => {
    for (const list of Object.values(s.messages[sessionKey] ?? {})) {
      const found = list.find((m) => m.authorId === memberId);
      if (found) return found;
    }
    return undefined;
  });
  if (!session) return null;
  const name = member?.display_name ?? fallback?.name ?? 'Alguien';
  const nick = member?.nickname ?? fallback?.nick ?? '';
  const self = memberId === session.member.id;
  const myRole = session.member.role;
  const canManage = !self && member && member.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && member.role === 'member'));
  const online = Boolean(presence?.online);

  return (
    <Shell title={name} wide={false}>
      <div className="modal-body profile">
        <div className="profile-head">
          <Avatar name={name} nick={nick} size={72} presence={online ? (presence?.presence ?? 'online') : 'offline'} />
          <div>
            <div className="profile-name">{name}</div>
            <div className="mono dim">@{nick}</div>
            <div className="profile-badges">
              {member ? <RoleBadge role={member.role} /> : null}
              <span className="dim">{member ? ROLE_LABEL[member.role] : 'ya no está en el servidor'}</span>
            </div>
          </div>
        </div>
        <div className="profile-status">
          <span className={`presence presence-${online ? (presence?.presence ?? 'online') : 'offline'}`} />
          {online ? presence?.text || PRESENCE_LABEL[presence?.presence ?? 'online'] : 'desconectado'}
        </div>
        {member ? (
          <div className="kv">
            <span>entró</span>
            <span>{new Date(member.joined_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        ) : null}
        <div className="modal-actions spread">
          {self ? (
            <>
              <Button tone="ghost" icon="log-out" onClick={() => confirmLeave(session.key)}>
                Salir del servidor
              </Button>
              <Button tone="purple" solid icon="edit-2" onClick={() => useApp.setState({ modal: { kind: 'status', key: session.key } })}>
                Editar estado
              </Button>
            </>
          ) : (
            <>
              {canManage && member ? (
                <span className="profile-manage">
                  <Button tone="ghost" small icon="shield" onClick={() => void setMemberRole(session.key, member.nickname, member.role === 'admin' ? 'member' : 'admin')}>
                    {member.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
                  </Button>
                  <Button tone="danger" small icon="user-x" onClick={() => confirmKick(session.key, member)}>
                    Echar
                  </Button>
                </span>
              ) : (
                <span />
              )}
              <Button
                tone="cyan"
                solid
                icon="message-circle"
                onClick={() => {
                  closeModal();
                  selectDm(session.key, memberId);
                }}
              >
                Mensaje directo
              </Button>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

function SettingsModal() {
  const settings = useSettings();
  const [nodeUrl, setNodeUrl] = useState(settings.nodeUrl);
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const { busy, error, submit } = useSubmit(async () => {
    if (nodeUrl.trim() !== settings.nodeUrl) {
      const ok = await changeNodeUrl(nodeUrl);
      if (!ok) throw new Error('No responde ningún nodo en esa dirección.');
    }
  });

  useEffect(() => {
    if (settings.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().then(setPermission);
    }
  }, [settings.notifications]);

  return (
    <Shell title="ajustes" subtitle={`hazel-desktop ${VERSION}`}>
      <form className="modal-body" onSubmit={submit}>
        <Field label="dirección de tu nodo" icon="server" value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)} hint="Donde corre `uv run python -m core node`. Por defecto http://127.0.0.1:7272." />
        <label className="toggle">
          <input type="checkbox" checked={settings.particles} onChange={(e) => settings.set({ particles: e.target.checked })} />
          <span className="toggle-track" />
          <span>
            Partículas en el fondo
            <small>Apagalas si la compu anda justa.</small>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.notifications} onChange={(e) => settings.set({ notifications: e.target.checked })} />
          <span className="toggle-track" />
          <span>
            Notificaciones del sistema
            <small>
              Cuando te mencionan o te escriben por privado y no estás mirando.
              {permission === 'denied' ? ' El sistema las tiene bloqueadas.' : ''}
            </small>
          </span>
        </label>
        <div className="form-note">
          <Icon name="info" size={12} /> El chat viaja directo entre las apps conectadas y cada app guarda su historial en esta compu.
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <Button tone="ghost" onClick={closeModal}>
            Cerrar
          </Button>
          <Button tone="cyan" solid icon="check" type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function ConfirmModal({ modal }: { modal: Extract<Modal, { kind: 'confirm' }> }) {
  const { busy, error, submit } = useSubmit(async () => {
    await modal.onConfirm();
  });
  return (
    <Shell title={modal.title}>
      <div className="modal-body">
        <p className="confirm-text">{modal.text}</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <Button tone="ghost" onClick={closeModal}>
            Cancelar
          </Button>
          <Button tone={modal.danger ? 'danger' : 'cyan'} solid loading={busy} onClick={() => submit()}>
            {modal.action}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

export function Modals() {
  const modal = useApp((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'create':
      return <CreateModal />;
    case 'join':
      return <JoinModal address={modal.address} />;
    case 'enter':
      return <EnterModal modal={modal} />;
    case 'status':
      return <StatusModal sessionKey={modal.key} />;
    case 'profile':
      return <ProfileModal sessionKey={modal.key} memberId={modal.memberId} />;
    case 'settings':
      return <SettingsModal />;
    case 'confirm':
      return <ConfirmModal modal={modal} />;
    default:
      return null;
  }
}
