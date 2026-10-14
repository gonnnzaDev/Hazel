import { ActivityIndicator, Text, View } from 'react-native';

import { colors, glow, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

type Tone = 'cyan' | 'purple' | 'lime' | 'danger' | 'ghost';

const TONES: Record<Tone, string> = {
  cyan: colors.cyan,
  purple: colors.purple,
  lime: colors.lime,
  danger: colors.danger,
  ghost: colors.textMuted,
};

interface NeonButtonProps {
  label: string;
  onPress: () => void;
  tone?: Tone;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Relleno sólido en vez de contorno. Para la acción principal de una pantalla. */
  solid?: boolean;
  compact?: boolean;
}

/** Botón con borde neón; el sólido brilla. */
export function NeonButton({
  label,
  onPress,
  tone = 'cyan',
  icon,
  loading,
  disabled,
  solid = false,
  compact = false,
}: NeonButtonProps) {
  const color = TONES[tone];
  const fg = solid ? colors.base : color;

  return (
    <Touchable onPress={onPress} disabled={disabled || loading} haptic="tap" accessibilityLabel={label}>
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: compact ? 36 : 48,
            paddingHorizontal: compact ? 14 : 20,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: tone === 'ghost' ? colors.borderStrong : `${color}88`,
            backgroundColor: solid ? color : `${color}14`,
          },
          solid && !disabled ? glow(color, 16, 0.6) : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <>
            {icon ? <Icon name={icon} size={compact ? 15 : 17} color={fg} /> : null}
            <Text className="font-mono-bold" style={{ color: fg, fontSize: compact ? 12 : 14, letterSpacing: 0.5 }}>
              {label}
            </Text>
          </>
        )}
      </View>
    </Touchable>
  );
}
