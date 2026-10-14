import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, radii, spring } from '@/theme';

import { Glass } from './Glass';

interface SheetProps {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 900;

/**
 * Bottom sheet de vidrio: entra con un resorte desde abajo, se cierra
 * arrastrándolo, tocando afuera o con el botón atrás del sistema.
 */
export function Sheet({ title, subtitle, onClose, children }: SheetProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, spring);
    backdrop.value = withTiming(1, { duration: 220 });
  }, [translateY, backdrop]);

  const close = () => {
    backdrop.value = withTiming(0, { duration: 180 });
    translateY.value = withTiming(height, { duration: 220 }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  };

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        backdrop.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(height, { duration: 200 }, (finished) => {
          if (finished) scheduleOnRN(onClose);
        });
      } else {
        translateY.value = withSpring(0, spring);
      }
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Cerrar" />
      </Animated.View>

      <Animated.View style={[styles.panel, { maxHeight: height * 0.86 }, panelStyle]}>
        <Glass strong radius={radii.lg + 8} intensity={90} style={{ flexShrink: 1 }}>
          <GestureDetector gesture={pan}>
            <View className="items-center pb-1 pt-2.5">
              <View style={styles.handle} />
              {title ? (
                <View className="w-full flex-row items-baseline gap-2 px-5 pt-3">
                  <Text className="font-mono-bold text-base text-ink">{title}</Text>
                  {subtitle ? <Text className="flex-1 font-mono text-xs text-dim">{subtitle}</Text> : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>
          <View style={{ paddingBottom: Math.max(insets.bottom, 16) }}>{children}</View>
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
});
