import type { ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useHaptics } from '@/hooks/useHaptics';
import { spring } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TouchableProps {
  children: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  className?: string;
  disabled?: boolean;
  /** Cuánto se achica al apretar. */
  scaleTo?: number;
  haptic?: 'tap' | 'select' | 'none';
  accessibilityLabel?: string;
  hitSlop?: number;
}

/**
 * Todo lo que se toca en la app: se achica un poco con un resorte al apretar
 * y vibra apenas. Es el "feel" de Hyprland llevado al dedo.
 */
export function Touchable({
  children,
  onPress,
  onLongPress,
  style,
  className,
  disabled,
  scaleTo = 0.96,
  haptic = 'tap',
  accessibilityLabel,
  hitSlop,
}: TouchableProps) {
  const scale = useSharedValue(1);
  const haptics = useHaptics();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => {
        scale.value = withSpring(scaleTo, spring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, spring);
      }}
      onPress={(event) => {
        if (haptic === 'tap') haptics.tap();
        else if (haptic === 'select') haptics.select();
        onPress?.(event);
      }}
      onLongPress={
        onLongPress
          ? (event) => {
              haptics.press();
              onLongPress(event);
            }
          : undefined
      }
      className={className}
      style={[animated, disabled ? { opacity: 0.45 } : null, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
