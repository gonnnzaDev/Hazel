import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { displayName } from '@/store/people';
import { useMessages } from '@/store/messages';
import { ME_ID } from '@/mocks/users';
import { colors } from '@/theme';

function TypingDot({ delay }: { delay: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-3, { duration: 260 }), withTiming(0, { duration: 260 })), -1));
  }, [delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: 0.5 - y.value / 6 }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.cyan }, style]} />;
}

/** "Ana está escribiendo…" con tres puntos que saltan. */
export function TypingIndicator({ channelId }: { channelId: string }) {
  const room = useMessages((s) => s.typing[channelId]);
  const who = Object.keys(room ?? {}).filter((id) => id !== ME_ID);

  if (!who.length) return <View style={{ height: 20 }} />;

  const names = who.map(displayName);
  const label =
    names.length === 1
      ? `${names[0]} está escribiendo`
      : names.length === 2
        ? `${names[0]} y ${names[1]} están escribiendo`
        : 'Varias personas están escribiendo';

  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} className="h-5 flex-row items-center gap-2 px-4">
      <View className="flex-row gap-1">
        <TypingDot delay={0} />
        <TypingDot delay={130} />
        <TypingDot delay={260} />
      </View>
      <Text className="font-mono text-[11px] text-muted">{label}…</Text>
    </Animated.View>
  );
}
