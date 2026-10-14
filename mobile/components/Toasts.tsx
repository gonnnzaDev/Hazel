import { Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUi, type Toast } from '@/store/ui';
import { colors, radii, spring } from '@/theme';

import { Glass } from './ui/Glass';
import { Icon, type IconName } from './ui/Icon';

const TONES: Record<Toast['tone'], { icon: IconName; color: string }> = {
  info: { icon: 'info', color: colors.cyan },
  success: { icon: 'check-circle', color: colors.lime },
  error: { icon: 'alert-circle', color: colors.danger },
};

/** Avisos cortos debajo del Waybar, como notificaciones de mako. */
export function Toasts() {
  const insets = useSafeAreaInsets();
  const toasts = useUi((s) => s.toasts);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 52, left: 16, right: 16, gap: 8, zIndex: 80 }}>
      {toasts.map((toast) => {
        const tone = TONES[toast.tone];
        return (
          <Animated.View
            key={toast.id}
            entering={FadeInUp.springify().damping(spring.damping).stiffness(spring.stiffness)}
            exiting={FadeOutUp.duration(160)}
          >
            <Glass strong radius={radii.md} glowColor={tone.color}>
              <View className="flex-row items-center gap-2.5 px-3.5 py-3">
                <Icon name={tone.icon} size={16} color={tone.color} />
                <Text className="flex-1 font-mono text-[12px] text-ink">{toast.text}</Text>
              </View>
            </Glass>
          </Animated.View>
        );
      })}
    </View>
  );
}
