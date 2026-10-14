import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

const BARS = 14;

function Bar({ index, active, color }: { index: number; active: boolean; color: string }) {
  const height = useSharedValue(2);

  useEffect(() => {
    if (!active) {
      height.value = withTiming(2, { duration: 220 });
      return;
    }
    // Cada barra con su ritmo: así parece voz y no un ecualizador sincronizado.
    const peak = 6 + Math.abs(Math.sin(index * 1.7)) * 16;
    const duration = 160 + (index % 5) * 45;
    height.value = withDelay(
      index * 25,
      withRepeat(
        withSequence(
          withTiming(peak, { duration, easing: Easing.out(Easing.quad) }),
          withTiming(3 + (index % 3) * 2, { duration, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        true,
      ),
    );
  }, [active, height, index]);

  const style = useAnimatedStyle(() => ({ height: height.value }));
  return <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: color, opacity: active ? 1 : 0.35 }, style]} />;
}

/** Visualizador de onda tipo HUD: se mueve mientras la persona habla. */
export function Waveform({ active, color = colors.lime }: { active: boolean; color?: string }) {
  return (
    <View className="h-6 flex-row items-center justify-center gap-[3px]">
      {Array.from({ length: BARS }, (_, i) => (
        <Bar key={i} index={i} active={active} color={color} />
      ))}
    </View>
  );
}
