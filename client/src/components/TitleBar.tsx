import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import mark from '../assets/hazel-mark.svg';
import { useAppStore } from '../state/store';

type Action = 'minimize' | 'maximize' | 'close';

/** Barra de título propia: la ventana nativa se declara sin decoraciones. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const native = isTauri();
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  useEffect(() => {
    if (!native) return;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [native]);

  async function handle(action: Action) {
    if (!native) return;
    const win = getCurrentWindow();
    switch (action) {
      case 'minimize':
        await win.minimize();
        break;
      case 'maximize':
        await win.toggleMaximize();
        setMaximized(await win.isMaximized());
        break;
      case 'close':
        await win.close();
        break;
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!native) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  }

  return (
    <div className="titlebar" data-tauri-drag-region onPointerDown={handlePointerDown}>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src={mark} alt="" className="titlebar-logo" data-tauri-drag-region />
        <span data-tauri-drag-region>Hazel</span>
        <button
          type="button"
          className="titlebar-theme"
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
          title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
        >
          <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
        </button>
      </div>
      <div className="titlebar-controls" data-tauri-drag-region>
        <button
          type="button"
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => void handle('minimize')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
          title={maximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => void handle('maximize')}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2.5" y="1" width="6" height="6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M1.5 3 V8.5 H7" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar-close"
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => void handle('close')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2 L8 8 M8 2 L2 8" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
