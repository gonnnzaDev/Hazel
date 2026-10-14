import { Text, View } from 'react-native';

import { colors, glow } from '@/theme';

interface BadgeProps {
  count: number;
  /** Rojo para menciones, cyan para no leídos. */
  tone?: 'mention' | 'unread';
}

/** Contador neón. No se muestra si es cero. */
export function Badge({ count, tone = 'unread' }: BadgeProps) {
  if (count <= 0) return null;
  const color = tone === 'mention' ? colors.danger : colors.cyan;
  return (
    <View
      style={[
        {
          minWidth: 18,
          height: 18,
          paddingHorizontal: 5,
          borderRadius: 9,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        },
        glow(color, 8, 0.7),
      ]}
    >
      <Text className="font-mono-bold text-[10px]" style={{ color: colors.base }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

/** Punto de "hay algo nuevo" sin número. */
export function Dot({ color = colors.text, size = 8 }: { color?: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
