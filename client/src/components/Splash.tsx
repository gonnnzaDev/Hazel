import mark from '../assets/hazel-mark.svg';
import type { Dependency } from '../state/deps';

type Props = {
  missing: Dependency[];
  checking: boolean;
  onContinue: () => void;
};

/** Pantalla de arranque: logo animado y, si falta algo, los comandos para instalarlo. */
export function Splash({ missing, checking, onContinue }: Props) {
  async function copyAll() {
    const text = missing.map((dep) => `# ${dep.name}\n${dep.install}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // El usuario puede seleccionar el texto manualmente.
    }
  }

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

        {missing.length > 0 && (
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
            <div className="splash-deps-actions">
              <button type="button" onClick={() => void copyAll()}>Copiar comandos</button>
              <button type="button" className="splash-continue" onClick={onContinue}>
                Continuar igualmente
              </button>
            </div>
          </div>
        )}
      </div>
      {missing.length === 0 && (
        <div className="splash-progress"><span /></div>
      )}
    </div>
  );
}
