// Widgets de monitoreo: latencia al nodo y uso de CPU y memoria de esta compu.
// Una sola serie por widget, barras finas apoyadas en la base, y el valor en
// texto. Pasando el mouse por una barra se ve ese momento.

import { useState } from 'react';

import { HISTORY, useApp } from '../store/app';
import { latencyState } from './hooks';
import { Icon } from './ui';

const SAMPLE_SECONDS = 2;

function Bars({ values, max, color, onInspect }: { values: number[]; max: number; color: string; onInspect: (i: number | null) => void }) {
  const padded = [...Array(Math.max(0, HISTORY - values.length)).fill(null), ...values] as (number | null)[];
  return (
    <div className="bars" onMouseLeave={() => onInspect(null)}>
      {padded.map((value, i) => {
        const index = i - (HISTORY - values.length);
        const height = value === null ? 0 : Math.max(4, Math.min(100, (value / max) * 100));
        return (
          <span key={i} className="bar-hit" onMouseEnter={() => onInspect(value === null ? null : index)}>
            <span
              className={value === null ? 'bar empty' : i === padded.length - 1 ? 'bar last' : 'bar'}
              style={{ height: `${height}%`, background: value === null ? undefined : color }}
            />
          </span>
        );
      })}
    </div>
  );
}

export function NetMonitor() {
  const { ms, history, target } = useApp((s) => s.latency);
  const [inspected, setInspected] = useState<number | null>(null);
  const state = latencyState(ms);
  const shown = inspected !== null ? history[inspected] : ms;
  const ago = inspected !== null ? (history.length - 1 - inspected) * SAMPLE_SECONDS : 0;
  const valid = history.filter((v) => v > 0);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const peak = valid.length ? Math.max(...valid) : null;
  let host = target;
  try {
    host = new URL(target).host;
  } catch {
    // queda como está
  }

  return (
    <div className="widget glass">
      <div className="widget-head">
        <span className="widget-title">latencia</span>
        <span className={`widget-state tone-${state.tone}`}>
          <Icon name={state.tone === 'good' ? 'check-circle' : state.tone === 'down' ? 'wifi-off' : 'alert-triangle'} size={12} />
          {state.label}
        </span>
      </div>
      <div className="widget-value">
        <span className="widget-number">{shown == null || shown === 0 ? '—' : Math.round(shown)}</span>
        <span className="widget-unit">ms</span>
        <span className="widget-when">{inspected !== null ? `hace ${ago}s` : 'ahora'}</span>
      </div>
      <Bars values={history} max={Math.max(120, peak ?? 0)} color="#00E5FF" onInspect={setInspected} />
      <div className="widget-foot">
        <span>prom {avg === null ? '—' : `${Math.round(avg)}ms`}</span>
        <span className="mono dim">{host}</span>
        <span>máx {peak === null ? '—' : `${Math.round(peak)}ms`}</span>
      </div>
    </div>
  );
}

function bytes(value: number): string {
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function CpuMonitor() {
  const { cpu, cores, memUsed, memTotal, available } = useApp((s) => s.system);
  const [inspected, setInspected] = useState<number | null>(null);
  if (!available) {
    return (
      <div className="widget glass">
        <div className="widget-head">
          <span className="widget-title">cpu</span>
        </div>
        <p className="widget-empty">Disponible en la app de escritorio.</p>
      </div>
    );
  }
  const now = cpu[cpu.length - 1] ?? 0;
  const shown = inspected !== null ? (cpu[inspected] ?? 0) : now;
  const ago = inspected !== null ? (cpu.length - 1 - inspected) * SAMPLE_SECONDS : 0;
  const heavy = now > 0.85;
  return (
    <div className="widget glass">
      <div className="widget-head">
        <span className="widget-title">cpu · {cores} núcleos</span>
        <span className={`widget-state ${heavy ? 'tone-bad' : 'tone-good'}`}>
          <Icon name={heavy ? 'alert-triangle' : 'check-circle'} size={12} />
          {heavy ? 'exigida' : 'normal'}
        </span>
      </div>
      <div className="widget-value">
        <span className="widget-number">{Math.round(shown * 100)}</span>
        <span className="widget-unit">%</span>
        <span className="widget-when">{inspected !== null ? `hace ${ago}s` : 'ahora'}</span>
      </div>
      <Bars values={cpu.map((v) => v * 100)} max={100} color="#A855F7" onInspect={setInspected} />
      <div className="widget-foot">
        <span>memoria</span>
        <span className="mono dim">
          {bytes(memUsed)} / {bytes(memTotal)}
        </span>
        <span>{memTotal ? Math.round((memUsed / memTotal) * 100) : 0}%</span>
      </div>
    </div>
  );
}
