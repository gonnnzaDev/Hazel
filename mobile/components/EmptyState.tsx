import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { colors } from '@/theme';

import { Icon, type IconName } from './ui/Icon';

/** Lo que se muestra cuando una lista está vacía. */
export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <View className="items-center gap-2 px-8 py-12">
      <View
        className="mb-1 h-14 w-14 items-center justify-center rounded-2xl"
        style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.03)' }}
      >
        <Icon name={icon} size={24} color={colors.textDim} />
      </View>
      <Text className="text-center font-mono-bold text-sm text-ink">{title}</Text>
      {text ? <Text className="text-center font-sans text-xs text-muted">{text}</Text> : null}
      {children}
    </View>
  );
}
