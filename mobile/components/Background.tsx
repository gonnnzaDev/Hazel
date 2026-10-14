import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useMemo, type RefObject } from 'react';
import { StyleSheet, View, useWindowDimensions, type View as ViewType } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useUi } from '@/store/ui';
import { colors } from '@/theme';

const GRID = 36;
const PARTICLES = 16;

/**
 * El fondo de toda la app: degradé profundo, una grilla tenue como de HUD,
 * dos manchas de luz neón y partículas que suben despacio. Es lo que los
 * paneles de vidrio difuminan.
 */
export function Background({ targetRef }: { targetRef: RefObject<ViewType | null> }) {
  const particles = useUi((s) => s.settings.particles);

  return (
    <BlurTargetView ref={targetRef} style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[colors.base, '#0b1322', '#120b22', colors.base]}
        locations={[0, 0.4, 0.75, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Orb color={colors.cyan} style={{ top: -140, left: -120 }} />
      <Orb color={colors.purple} style={{ bottom: -160, right: -140 }} />
      <Grid />
      {particles ? <Particles /> : null}
    </BlurTargetView>
  );
}

function Orb({ color, style }: { color: string; style: object }) {
  return (
    <View
      style={[
        {
          position: 'absolute',
          width: 360,
          height: 360,
          borderRadius: 180,
          backgroundColor: color,
          opacity: 0.07,
        },
        style,
      ]}
    />
  );
}

const Grid = memo(function Grid() {
  const { width, height } = useWindowDimensions();
  const columns = Math.ceil(width / GRID);
  const rows = Math.ceil(height / GRID);
  const line = 'rgba(0, 229, 255, 0.035)';

  return (
    <View style={StyleSheet.absoluteFill}>
      {Array.from({ length: columns }, (_, i) => (
        <View key={`c${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: i * GRID, width: 1, backgroundColor: line }} />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <View key={`r${i}`} style={{ position: 'absolute', left: 0, right: 0, top: i * GRID, height: 1, backgroundColor: line }} />
      ))}
    </View>
  );
});

function Particles() {
  const { width, height } = useWindowDimensions();
  // Posiciones fijas por montaje: si cambiaran en cada render, saltarían.
  const seeds = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 1.5 + Math.random() * 2,
        duration: 14_000 + Math.random() * 16_000,
        delay: Math.random() * 4000,
        color: i % 3 === 0 ? colors.purple : i % 3 === 1 ? colors.cyan : colors.lime,
      })),
    [width, height],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      {seeds.map((seed, i) => (
        <Particle key={i} {...seed} travel={height * 0.6} />
      ))}
    </View>
  );
}

interface ParticleProps {
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  color: string;
  travel: number;
}

function Particle({ x, y, size, duration, delay, color, travel }: ParticleProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
  }, [progress, delay, duration]);

  const style = useAnimatedStyle(() => ({
    opacity: Math.sin(progress.value * Math.PI) * 0.55,
    transform: [{ translateY: -progress.value * travel }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
          shadowColor: color,
          shadowOpacity: 1,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}
