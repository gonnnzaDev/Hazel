import { Text, View } from 'react-native';

import { colors } from '@/theme';

/** Título de sección en mono, con una línea que lo sigue: `── amigos ─────`. */
export function SectionLabel({ children, right }: { children: string; right?: string }) {
  return (
    <View className="flex-row items-center gap-2 px-1 pb-1 pt-3">
      <Text className="font-mono text-[11px] uppercase tracking-widest text-dim">{children}</Text>
      <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
      {right ? <Text className="font-mono text-[11px] text-dim">{right}</Text> : null}
    </View>
  );
}
