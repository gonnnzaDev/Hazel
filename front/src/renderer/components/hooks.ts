// Hooks chicos de la interfaz.

import { useEffect, useState } from 'react';

/** La hora, actualizada cada `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}

/** Batería real de la compu (Chromium la expone); `null` si no tiene o no se sabe. */
export function useBattery(): { level: number; charging: boolean } | null {
  const [state, setState] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) return;
    let battery: BatteryManager | null = null;
    const update = () => {
      if (battery) setState({ level: battery.level, charging: battery.charging });
    };
    nav
      .getBattery()
      .then((b) => {
        battery = b;
        // Una PC de escritorio dice "cargando al 100%" para siempre: no tiene sentido mostrarlo.
        if (b.level === 1 && b.charging) return;
        update();
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
      })
      .catch(() => {});
    return () => {
      battery?.removeEventListener('levelchange', update);
      battery?.removeEventListener('chargingchange', update);
    };
  }, []);
  return state;
}

/** Clasifica una latencia para mostrarla con ícono, texto y color. */
export function latencyState(ms: number | null): { label: string; tone: 'good' | 'warn' | 'bad' | 'down' } {
  if (ms === null) return { label: 'sin conexión', tone: 'down' };
  if (ms < 80) return { label: 'estable', tone: 'good' };
  if (ms < 200) return { label: 'lenta', tone: 'warn' };
  return { label: 'inestable', tone: 'bad' };
}
