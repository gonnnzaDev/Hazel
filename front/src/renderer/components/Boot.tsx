// Pantalla de arranque estilo terminal. Cada línea es un paso real: conectar
// con el nodo, contar servidores, validar sesiones, abrir el chat, revisar el
// micrófono. Se va sola al terminar; un clic la saltea.

import { useEffect, useState } from 'react';

import { useApp } from '../store/app';
import { Logo } from './ui';

const MIN_VISIBLE_MS = 1800;

const TAG_CLASS: Record<string, string> = {
  INFO: 'tag-info',
  ' OK ': 'tag-ok',
  WAIT: 'tag-wait',
  FAIL: 'tag-fail',
  WARN: 'tag-warn',
};

export function Boot() {
  const { lines, done } = useApp((s) => s.boot);
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!done) return;
    // Con un nodo rápido el arranque dura un instante: se deja ver al menos un poco.
    const wait = Math.max(650, MIN_VISIBLE_MS - (Date.now() - mountedAt));
    const leave = setTimeout(() => setLeaving(true), wait);
    const hide = setTimeout(() => setHidden(true), wait + 450);
    return () => {
      clearTimeout(leave);
      clearTimeout(hide);
    };
  }, [done, mountedAt]);

  if (hidden) return null;

  const settled = lines.filter((l) => l.tag !== 'WAIT').length;
  const progress = done ? 1 : Math.min(0.92, settled / 7);

  return (
    <div
      className={leaving ? 'boot leaving' : 'boot'}
      onClick={() => {
        if (done) setHidden(true);
      }}
      role="status"
      aria-live="polite"
    >
      <div className="boot-head">
        <Logo size={48} glow />
        <div>
          <div className="boot-title">hazel</div>
          <div className="boot-sub">tu chat · tu máquina · tu puerto</div>
        </div>
      </div>
      <div className="boot-log">
        {lines.map((line) => (
          <div key={line.id} className="boot-line">
            <span className={`boot-tag ${TAG_CLASS[line.tag] ?? ''}`}>[{line.tag}]</span> {line.text}
          </div>
        ))}
        <div className="boot-line">
          <span className="boot-prompt">❯</span> <span className="cursor" />
        </div>
      </div>
      <div className="boot-foot">
        <div className="boot-bar">
          <div className="boot-bar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="boot-hint">{done ? 'clic para entrar' : 'arrancando…'}</div>
      </div>
    </div>
  );
}
