import mark from '../assets/hazel-mark.svg';
import type { Dependency } from '../state/deps';

type Props = {
  missing: Dependency[];
  checking: boolean;
  installLog: string[];
  installError: string | null;
  onContinue: () => void;
};

/** Pantalla de arranque: logo animado e instalación automática de dependencias. */
export function Splash({ missing, checking, installLog, installError, onContinue }: Props) {
  async function copyAll() {
    const text = missing.map((dep) => `# ${dep.name}\n${dep.install}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // El usuario puede seleccionar el texto manualmente.
    }
  }

  const installing = installLog.length > 0 && !installError;

  return (
    <div className="splash" role="status" aria-label="Cargando Hazel">
      <div className="splash-inner">
        <div className="splash-logo">
          <span className="splash-halo" />
          <img src={mark} alt="" className="splash-mark" />
        </div>
        <div className="splash-name">Hazel</div>
        <div className="splash-tagline">Tu chat. Tu máquina. Tu puerto.</div>

        {checking && <p className="splash-checking">Comprobando dependencias…</p>}

        {installing && (
          <div className="splash-deps">
            <p className="splash-deps-title">Instalando lo que falta…</p>
            <pre className="splash-log">{installLog.slice(-12).join('\n')}</pre>
          </div>
        )}

        {installError && (
          <div className="splash-deps">
            <p className="splash-deps-title">No se pudo instalar automáticamente</p>
            <p className="muted">{installError}</p>
            <ul>
              {missing.map((dep) => (
                <li key={dep.name}>
                  <strong>{dep.name}</strong>
                  <span className="muted">{dep.why}</span>
                  <code>{dep.install}</code>
                </li>
              ))}
            </ul>
            <div className="splash-deps-actions">
              <button type="button" onClick={() => void copyAll()}>Copiar comandos</button>
              <button type="button" className="splash-continue" onClick={onContinue}>
                Continuar igualmente
              </button>
            </div>
          </div>
        )}

        {missing.length > 0 && !installing && !installError && (
          <div className="splash-deps">
            <p className="splash-deps-title">Faltan dependencias para usar Hazel al 100%</p>
            <ul>
              {missing.map((dep) => (
                <li key={dep.name}>
                  <strong>{dep.name}</strong>
                  <span className="muted">{dep.why}</span>
                  <code>{dep.install}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {missing.length === 0 && !installing && (
        <div className="splash-progress"><span /></div>
      )}
    </div>
  );
}
