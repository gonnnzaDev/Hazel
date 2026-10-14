import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

import { colors } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

/** Íconos de línea (Feather): finos, como los de Waybar. */
export function Icon({ name, size = 18, color = colors.textMuted }: IconProps) {
  return <Feather name={name} size={size} color={color} />;
}
