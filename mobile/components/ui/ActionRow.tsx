import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { colors } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

interface ActionRowProps {
  icon: IconName;
  label: string;
  description?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
}

/** Una fila de acción en un sheet o un menú. */
export function ActionRow({ icon, label, description, onPress, danger, right }: ActionRowProps) {
  const color = danger ? colors.danger : colors.text;
  const content = (
    <View className="flex-row items-center gap-3 rounded-2xl px-3 py-3">
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: danger ? 'rgba(255,77,109,0.12)' : 'rgba(255,255,255,0.05)' }}
      >
        <Icon name={icon} size={17} color={danger ? colors.danger : colors.cyan} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-medium text-[15px]" style={{ color }}>
          {label}
        </Text>
        {description ? <Text className="font-sans text-xs text-dim">{description}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={16} color={colors.textDim} /> : null)}
    </View>
  );
  return onPress ? (
    <Touchable onPress={onPress} scaleTo={0.98}>
      {content}
    </Touchable>
  ) : (
    content
  );
}
