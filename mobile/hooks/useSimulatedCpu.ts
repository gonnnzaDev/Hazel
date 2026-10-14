import { useEffect, useState } from 'react';

const SAMPLES = 24;

/**
 * Uso de CPU simulado para el widget: un paseo aleatorio con picos de vez en
 * cuando. Una app no puede leer el CPU real del sistema en iOS ni en Android
 * sin módulos nativos propios.
 */
export function useSimulatedCpu(intervalMs = 1500): number[] {
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: SAMPLES }, () => 18 + Math.random() * 10));

  useEffect(() => {
    const timer = setInterval(() => {
      setHistory((prev) => {
        const last = prev[prev.length - 1] ?? 20;
        const spike = Math.random() < 0.08 ? 35 : 0;
        const next = Math.min(98, Math.max(4, last + (Math.random() - 0.5) * 14 + spike - (last > 60 ? 12 : 0)));
        return [...prev.slice(1 - SAMPLES), next];
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return history;
}
