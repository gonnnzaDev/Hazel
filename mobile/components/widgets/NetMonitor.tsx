import { useState } from 'react';
import { Text, View } from 'react-native';

import { useNet } from '@/store/net';
import { colors, radii } from '@/theme';

import { Glass } from '../ui/Glass';
import { Icon, type IconName } from '../ui/Icon';
import { Bars } from './Bars';

const SAMPLE_SECONDS = 2;

function health(ms: number | null): { label: string; icon: IconName; color: string } {
  if (ms === null) return { label: 'midiendo', icon: 'loader', color: colors.textDim };
  if (ms < 60) return { label: 'estable', icon: 'check-circle', color: colors.lime };
  if (ms < 120) return { label: 'irregular', icon: 'alert-triangle', color: colors.warning };
  return { label: 'mala', icon: 'alert-octagon', color: colors.danger };
}

/** Widget de red: latencia actual, promedio y máximo, y su historia reciente. */
export function NetMonitor() {
  const { latency, history, status } = useNet();
  const [inspected, setInspected] = useState<number | null>(null);

  const avg = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null;
  const peak = history.length ? Math.max(...history) : null;
  const state = health(status === 'online' ? latency : null);
  const shown = inspected !== null ? history[inspected] : latency;
  const ago = inspected !== null ? (history.length - 1 - inspected) * SAMPLE_SECONDS : 0;

  return (
    <Glass radius={radii.lg} style={{ flex: 1 }}>
      <View className="gap-2 p-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-mono text-[10px] uppercase tracking-widest text-dim">latencia</Text>
          <View className="flex-row items-center gap-1">
            <Icon name={state.icon} size={11} color={state.color} />
            <Text className="font-mono text-[10px] text-muted">{state.label}</Text>
          </View>
        </View>
        <View className="flex-row items-baseline gap-1">
          <Text className="font-mono-bold text-2xl text-ink">{shown ?? '—'}</Text>
          <Text className="font-mono text-xs text-muted">ms</Text>
          <Text className="ml-auto font-mono text-[10px] text-dim">{inspected !== null ? `hace ${ago}s` : 'ahora'}</Text>
        </View>
        <Bars values={history.length ? history : [0]} max={150} color={colors.cyan} onInspect={setInspected} />
        <View className="flex-row justify-between">
          <Text className="font-mono text-[10px] text-dim">prom {avg ?? '—'}ms</Text>
          <Text className="font-mono text-[10px] text-dim">máx {peak ?? '—'}ms</Text>
        </View>
      </View>
    </Glass>
  );
}
