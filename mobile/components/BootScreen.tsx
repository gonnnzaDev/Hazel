import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, glow } from '@/theme';

type Level = 'OK' | 'INFO' | 'WAIT';

const LINES: [Level, string][] = [
  ['INFO', 'recop-boot v0.1.0 — kernel 6.18-hypr'],
  ['OK', 'Started Wayland compositor (hyprland)'],
  ['OK', 'Mounted /dev/nvme0n1p2 → /recop'],
  ['OK', 'Reached target Network Online'],
  ['WAIT', 'Resolviendo nodos en la red local…'],
  ['OK', 'Cargando servidores y canales'],
  ['OK', 'Abriendo socket de tiempo real'],
  ['OK', 'Iniciando motor de voz (WebRTC)'],
  ['INFO', 'Bienvenido a recop. Todo corre en la compu de alguien.'],
];

const LEVEL_COLORS: Record<Level, string> = { OK: colors.lime, INFO: colors.cyan, WAIT: colors.warning };
const LINE_MS = 170;

/**
 * Pantalla de arranque estilo terminal: líneas de boot que aparecen de a una,
 * una barra de progreso y un fundido. Se puede saltar tocando.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(0);
  const opacity = useSharedValue(1);
  const progress = useSharedValue(0);
  const cursor = useSharedValue(1);

  const finish = () => {
    opacity.value = withTiming(0, { duration: 380 }, (done) => {
      if (done) scheduleOnRN(onDone);
    });
  };

  useEffect(() => {
    cursor.value = withRepeat(withSequence(withTiming(0, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    progress.value = withTiming(1, { duration: LINES.length * LINE_MS + 300 });
    const timers = LINES.map((_, i) => setTimeout(() => setShown(i + 1), (i + 1) * LINE_MS));
    const end = setTimeout(finish, LINES.length * LINE_MS + 650);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(end);
    };
    // Corre una sola vez, al montar.
  }, []);

  const rootStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursor.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]}>
      <Pressable style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 48, paddingHorizontal: 24 }]} onPress={finish}>
        <View className="mb-8 flex-row items-center gap-3">
          <View style={[styles.logo, glow(colors.cyan, 18, 0.7)]}>
            <Image source={require('@/assets/images/glyph.png')} style={{ width: 34, height: 34, tintColor: colors.base }} />
          </View>
          <View>
            <Text className="font-mono-bold text-2xl text-ink">recop</Text>
            <Text className="font-mono text-xs text-dim">tu chat · tu máquina · tu puerto</Text>
          </View>
        </View>

        {LINES.slice(0, shown).map(([level, text], i) => (
          <Text key={i} className="font-mono-regular text-[12px] leading-5 text-muted">
            <Text style={{ color: LEVEL_COLORS[level] }}>[{level.padStart(4, ' ').padEnd(5, ' ')}]</Text> {text}
          </Text>
        ))}
        <View className="mt-1 flex-row items-center">
          <Text className="font-mono text-[12px] text-cyan">❯ </Text>
          <Animated.View style={[{ width: 8, height: 15, backgroundColor: colors.cyan }, cursorStyle]} />
        </View>

        <View style={[styles.track, { bottom: insets.bottom + 48 }]}>
          <Animated.View style={[styles.bar, glow(colors.cyan, 10, 0.9), barStyle]} />
        </View>
        <Text className="absolute self-center font-mono text-[10px] text-dim" style={{ bottom: insets.bottom + 24 }}>
          tocá para saltar
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#05070a', zIndex: 100 },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
    overflow: 'visible',
  },
  bar: { height: 2, borderRadius: 1, backgroundColor: colors.cyan },
});
