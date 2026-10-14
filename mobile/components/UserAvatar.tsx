import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import type { User } from '@/api/types';
import { colors, presenceColors } from '@/theme';

interface UserAvatarProps {
  user: User | undefined;
  size?: number;
  /** Muestra el punto de presencia abajo a la derecha. */
  showPresence?: boolean;
  /** Anillo verde lima que late: está hablando en voz. */
  speaking?: boolean;
  /** Color del fondo detrás, para recortar el punto de presencia. */
  ringBackground?: string;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join('')
      .toUpperCase() || '?'
  );
}

/** Avatar circular con iniciales o emoji, presencia y anillo de "hablando". */
export function UserAvatar({
  user,
  size = 40,
  showPresence = false,
  speaking = false,
  ringBackground = colors.base,
}: UserAvatarProps) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = speaking
      ? withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.4, { duration: 420 })), -1, true)
      : withTiming(0, { duration: 200 });
  }, [speaking, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }));

  const dot = Math.max(10, Math.round(size * 0.3));
  const presence = user?.presence ?? 'offline';

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: -4,
            left: -4,
            right: -4,
            bottom: -4,
            borderRadius: (size + 8) / 2,
            borderWidth: 2,
            borderColor: colors.lime,
            shadowColor: colors.lime,
            shadowOpacity: 0.9,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
          },
          ring,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: user?.avatarColor ?? colors.baseRaised,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
        }}
      >
        <Text
          className={user?.avatarEmoji ? 'font-sans' : 'font-mono-bold'}
          style={{ color: '#fff', fontSize: user?.avatarEmoji ? size * 0.5 : size * 0.36 }}
        >
          {user?.avatarEmoji ?? initials(user?.displayName ?? '?')}
        </Text>
      </View>
      {showPresence ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: dot + 4,
            height: dot + 4,
            borderRadius: (dot + 4) / 2,
            backgroundColor: ringBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: presenceColors[presence],
              borderWidth: presence === 'offline' ? 2 : 0,
              borderColor: colors.textDim,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
