import { useEffect, useState, type FormEvent } from 'react';
import mark from '../assets/hazel-mark.svg';
import { useAppStore } from '../state/store';
import { ensureNode, loadAdminToken } from '../state/session';
import { validateCreateServer } from '../utils/validation';
import { ServerPicker } from './ServerPicker';

type Mode = 'choose' | 'join' | 'create';

export function ConnectPanel() {
  const servers = useAppStore((state) => state.servers);
  const joined = useAppStore((state) => state.joined);
  const loading = useAppStore((state) => state.loading);
  const join = useAppStore((state) => state.join);
  const joinWithInvite = useAppStore((state) => state.joinWithInvite);
  const createAndEnter = useAppStore((state) => state.createAndEnter);
  const loadServers = useAppStore((state) => state.loadServers);

  const [mode, setMode] = useState<Mode>('choose');
  const [serverId, setServerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [startingNode, setStartingNode] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    void loadServers();
    void loadAdminToken().then((token) => {
      if (token) setAdminToken(token);
    });
  }, [loadServers]);

  // Solo servidores nuevos: ni borrados ni aquellos donde ya tenemos sesión.
  const newServers = servers.filter(
    (server) => server.status !== 'deleted' && !joined.some((item) => item.server_id === server.id),
  );
  const selected = newServers.find((server) => server.id === serverId) ?? newServers[0] ?? null;

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!selected || !memberName.trim()) return;
    await join(selected.id, memberName.trim());
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!adminToken.trim() || !name.trim() || !slug.trim() || !ownerName.trim()) return;
    const invalid = validateCreateServer({ name, slug, description, ownerName });
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setStartingNode(true);
    setFormError(null);
    try {
      await ensureNode();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
      setStartingNode(false);
      return;
    }
    setStartingNode(false);
    await createAndEnter(
      {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        owner_name: ownerName.trim(),
      },
      adminToken.trim(),
    );
  }

  return (
    <div className="connect">
      <section className="connect-hero">
        <div className="brand">
          <img src={mark} alt="Hazel" className="home-mark" />
          <div>
            <h1>Hazel</h1>
            <p className="muted">Tu chat. Tu máquina. Tu puerto.</p>
          </div>
        </div>

        <p className="connect-lead">
          Un servidor que vive en tu ordenador. Comparte la dirección, elige un
          apodo y entra a hablar. Sin cuentas, sin intermediarios.
        </p>

        <ol className="connect-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Elige qué hacer</strong>
              <p>Únete a un grupo existente o crea uno nuevo en tu nodo.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Entra con tu apodo</strong>
              <p>Así te verán los demás dentro de ese servidor.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Habla en tiempo real</strong>
              <p>Canales, presencia y mensajes al instante.</p>
            </div>
          </li>
        </ol>

      </section>

      <section className="connect-forms">
        {mode === 'choose' && (
          <>
            <div className="connect-options">
              <button
                type="button"
                className="connect-option connect-option--join"
                data-num="01"
                onClick={() => setMode('join')}
              >
                <span className="connect-option-icon">↗</span>
                <span className="connect-option-text">
                  <strong>Unirse</strong>
                  <small>Entra en un servidor existente con tu apodo.</small>
                </span>
                <span className="connect-option-arrow">→</span>
              </button>
              <button
                type="button"
                className="connect-option connect-option--create"
                data-num="02"
                onClick={() => setMode('create')}
              >
                <span className="connect-option-icon">+</span>
                <span className="connect-option-text">
                  <strong>Crear servidor</strong>
                  <small>Abre un grupo nuevo en tu nodo.</small>
                </span>
                <span className="connect-option-arrow">→</span>
              </button>
            </div>
          </>
        )}

        {mode !== 'choose' && (
          <>
            <button type="button" className="connect-back" onClick={() => setMode('choose')}>
              ← Volver
            </button>

            {mode === 'join' && (
              <form onSubmit={(event) => void handleJoin(event)} className="stack">
                <p className="connect-question">Unirse a un servidor nuevo</p>
                <button
                  type="button"
                  className="server-picker-trigger"
                  onClick={() => setPickerOpen(true)}
                  disabled={newServers.length === 0}
                >
                  <span className="server-picker-icon" aria-hidden="true">▦</span>
                  <span className="server-picker-text">
                    <strong>{selected ? selected.name : 'Elige un servidor'}</strong>
                    <span className="muted">
                      {selected ? `/${selected.slug} · ${selected.status}` : 'Ver servidores nuevos'}
                    </span>
                  </span>
                  <span className="server-picker-arrow" aria-hidden="true">→</span>
                </button>
                {newServers.length === 0 && (
                  <p className="muted">
                    Ya estás en todos los servidores de este nodo, o crea uno nuevo desde el inicio.
                  </p>
                )}
                {selected && <p className="muted">{selected.description ?? 'Sin descripción'}</p>}
                <label>
                  Tu nombre
                  <input
                    value={memberName}
                    onChange={(event) => setMemberName(event.target.value)}
                    placeholder="Ana"
                    minLength={2}
                    maxLength={64}
                    autoComplete="nickname"
                  />
                </label>
                <button type="submit" disabled={loading || !selected || !memberName.trim()}>
                  Unirse
                </button>
                <div className="connect-invite">
                  <p className="group-label">¿TIENES UN CÓDIGO?</p>
                  <input
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    placeholder="Código de invitación"
                    aria-label="Código de invitación"
                  />
                  <button
                    type="button"
                    className="header-ghost"
                    disabled={loading || !inviteCode.trim() || !memberName.trim()}
                    onClick={() => void joinWithInvite(inviteCode, memberName)}
                  >
                    Usar invitación
                  </button>
                </div>
              </form>
            )}

            {mode === 'create' && (
              <form onSubmit={(event) => void handleCreate(event)} className="stack">
                <p className="connect-question">Crear un servidor</p>
                <label>
                  Nombre del servidor
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Luis House" />
                </label>
                <label>
                  Identificador
                  <input
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    placeholder="luis-house"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Descripción <span className="muted">(opcional)</span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Un sitio para hablar"
                  />
                </label>
                <label>
                  Tu nombre
                  <input
                    value={ownerName}
                    onChange={(event) => setOwnerName(event.target.value)}
                    placeholder="Luis"
                    minLength={2}
                    maxLength={64}
                  />
                </label>
                {formError && <p className="muted">{formError}</p>}
                <button
                  type="submit"
                  disabled={loading || startingNode || !adminToken.trim() || !name.trim() || !slug.trim() || !ownerName.trim()}
                >
                  {startingNode ? 'Iniciando nodo…' : 'Crear servidor'}
                </button>
              </form>
            )}
          </>
        )}

      </section>

      <ServerPicker
        open={pickerOpen}
        servers={newServers}
        selectedId={selected?.id ?? null}
        onSelect={setServerId}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
