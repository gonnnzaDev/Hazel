import { useState } from 'react';
import { Text, View } from 'react-native';

import { useSimulatedCpu } from '@/hooks/useSimulatedCpu';
import { colors, radii } from '@/theme';

import { Glass } from '../ui/Glass';
import { Bars } from './Bars';

/** Widget de CPU (simulado: ver hooks/useSimulatedCpu.ts). */
export function CpuMonitor() {
  const history = useSimulatedCpu();
  const [inspected, setInspected] = useState<number | null>(null);
  const current = history[history.length - 1] ?? 0;
  const shown = inspected !== null ? (history[inspected] ?? current) : current;

  return (
    <Glass radius={radii.lg} style={{ flex: 1 }}>
      <View className="gap-2 p-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-mono text-[10px] uppercase tracking-widest text-dim">cpu · simulado</Text>
          <Text className="font-mono text-[10px] text-muted">carga</Text>
        </View>
        <View className="flex-row items-baseline gap-1">
          <Text className="font-mono-bold text-2xl text-ink">{Math.round(shown)}</Text>
          <Text className="font-mono text-xs text-muted">%</Text>
          <Text className="ml-auto font-mono text-[10px] text-dim">{inspected !== null ? 'muestra' : 'ahora'}</Text>
        </View>
        <Bars values={history} max={100} color={colors.purple} onInspect={setInspected} />
        <View className="flex-row justify-between">
          <Text className="font-mono text-[10px] text-dim">0%</Text>
          <Text className="font-mono text-[10px] text-dim">100%</Text>
        </View>
      </View>
    </Glass>
  );
}
