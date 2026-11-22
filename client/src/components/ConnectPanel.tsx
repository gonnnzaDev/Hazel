import { useEffect, useState, type FormEvent } from 'react';
import mark from '../assets/hazel-mark.svg';
import { useAppStore } from '../state/store';
import { loadAdminToken } from '../state/session';

type Mode = 'choose' | 'join' | 'create';

export function ConnectPanel() {
  const servers = useAppStore((state) => state.servers);
  const loading = useAppStore((state) => state.loading);
  const join = useAppStore((state) => state.join);
  const createAndEnter = useAppStore((state) => state.createAndEnter);
  const loadServers = useAppStore((state) => state.loadServers);

  const [mode, setMode] = useState<Mode>('choose');
  const [serverId, setServerId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [ownerNickname, setOwnerNickname] = useState('');

  useEffect(() => {
    void loadServers();
    void loadAdminToken().then((token) => {
      if (token) setAdminToken(token);
    });
  }, [loadServers]);

  const selected = servers.find((server) => server.id === serverId) ?? servers[0] ?? null;

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!selected || !nickname.trim()) return;
    await join(selected.id, nickname.trim(), displayName.trim() || undefined);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!adminToken.trim() || !name.trim() || !slug.trim() || !ownerNickname.trim()) return;
    await createAndEnter(
      {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        owner_nickname: ownerNickname.trim(),
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
            <p className="connect-question">¿Qué quieres hacer?</p>
            <button type="button" className="connect-option" onClick={() => setMode('join')}>
              <span className="connect-option-icon">↗</span>
              <span className="connect-option-text">
                <strong>Unirse</strong>
                <small>Entra en un servidor existente con tu apodo.</small>
              </span>
              <span className="connect-option-arrow">→</span>
            </button>
            <button type="button" className="connect-option" onClick={() => setMode('create')}>
              <span className="connect-option-icon">+</span>
              <span className="connect-option-text">
                <strong>Crear servidor</strong>
                <small>Abre un grupo nuevo en tu nodo.</small>
              </span>
              <span className="connect-option-arrow">→</span>
            </button>
          </>
        )}

        {mode !== 'choose' && (
          <>
            <button type="button" className="connect-back" onClick={() => setMode('choose')}>
              ← Volver
            </button>

            {mode === 'join' && (
              <form onSubmit={(event) => void handleJoin(event)} className="stack">
                <p className="connect-question">Unirse a un servidor</p>
                <label>
                  Servidor
                  <select
                    value={selected?.id ?? ''}
                    onChange={(event) => setServerId(event.target.value)}
                    disabled={servers.length === 0}
                  >
                    {servers.length === 0 && <option value="">No hay servidores disponibles</option>}
                    {servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name} · {server.slug} ({server.status})
                      </option>
                    ))}
                  </select>
                </label>
                {selected && <p className="muted">{selected.description ?? 'Sin descripción'}</p>}
                <label>
                  Apodo
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="ana"
                    minLength={2}
                    maxLength={32}
                    autoComplete="nickname"
                  />
                </label>
                <label>
                  Nombre visible <span className="muted">(opcional)</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Ana"
                  />
                </label>
                <button type="submit" disabled={loading || !selected || !nickname.trim()}>
                  Unirse
                </button>
              </form>
            )}

            {mode === 'create' && (
              <form onSubmit={(event) => void handleCreate(event)} className="stack">
                <p className="connect-question">Crear un servidor</p>
                <label>
                  Token de administración del nodo
                  <input
                    type="password"
                    value={adminToken}
                    onChange={(event) => setAdminToken(event.target.value)}
                    placeholder="HAZEL_ADMIN_TOKEN"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p className="muted">
                  Se rellena solo desde el <code>.env</code> local. Solo se usa
                  para crear: al unirte como dueño obtienes automáticamente tu
                  token de servidor para administrarlo después.
                </p>
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
                  Tu apodo de dueño
                  <input
                    value={ownerNickname}
                    onChange={(event) => setOwnerNickname(event.target.value)}
                    placeholder="luis"
                    minLength={2}
                    maxLength={32}
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading || !adminToken.trim() || !name.trim() || !slug.trim() || !ownerNickname.trim()}
                >
                  Crear servidor
                </button>
              </form>
            )}
          </>
        )}

        <p className="fineprint">
          No hay cuentas: el apodo identifica a cada persona dentro de este servidor.
        </p>
      </section>
    </div>
  );
}
