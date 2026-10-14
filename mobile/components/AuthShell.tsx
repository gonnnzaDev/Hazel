import { useEffect, type ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, glow, radii, spring } from '@/theme';

import { Glass } from './ui/Glass';

/** El marco de las pantallas de entrada: logo con brillo, título tipo prompt y una tarjeta de vidrio. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const cursor = useSharedValue(1);

  useEffect(() => {
    cursor.value = withRepeat(withSequence(withTiming(0, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
  }, [cursor]);
  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursor.value }));

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      >
        <Animated.View entering={FadeInDown.springify().damping(spring.damping).stiffness(spring.stiffness)} className="gap-6">
          <View className="items-center gap-4">
            <View
              style={[
                { width: 72, height: 72, borderRadius: 20, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' },
                glow(colors.cyan, 26, 0.75),
              ]}
            >
              <Image source={require('@/assets/images/glyph.png')} style={{ width: 48, height: 48, tintColor: colors.base }} />
            </View>
            <View className="items-center gap-1">
              <View className="flex-row items-center">
                <Text className="font-mono-bold text-2xl text-ink">
                  <Text className="text-cyan">❯ </Text>
                  {title}
                </Text>
                <Animated.View style={[{ width: 10, height: 22, marginLeft: 4, backgroundColor: colors.cyan }, cursorStyle]} />
              </View>
              <Text className="text-center font-sans text-sm text-muted">{subtitle}</Text>
            </View>
          </View>

          <Glass radius={radii.lg + 4} strong>
            <View className="gap-4 p-5">{children}</View>
          </Glass>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
