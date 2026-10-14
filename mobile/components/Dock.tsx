import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DOCK_HEIGHT } from '@/hooks/useDockSpace';
import { useServers } from '@/store/servers';
import { useSocial } from '@/store/social';
import { useUi } from '@/store/ui';
import { useVoice } from '@/store/voice';
import { colors, glow, radii, spring } from '@/theme';

import { Badge, Dot } from './ui/Badge';
import { Glass } from './ui/Glass';
import { Icon, type IconName } from './ui/Icon';
import { Touchable } from './ui/Touchable';

const TABS: Record<string, { icon: IconName; label: string }> = {
  index: { icon: 'home', label: 'home' },
  dms: { icon: 'message-circle', label: 'dms' },
  voice: { icon: 'headphones', label: 'voz' },
  profile: { icon: 'user', label: 'perfil' },
};

/**
 * La barra de pestañas como un dock flotante: una píldora de vidrio con el
 * activo encendido en cyan y un indicador que se desliza con un resorte.
 * Mantener apretado "home" abre la paleta de comandos.
 */
export function Dock({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const openWofi = useUi((s) => s.openWofi);

  const dmUnread = useSocial((s) => Object.values(s.unread).reduce((a, b) => a + b, 0));
  const mentions = useServers((s) => Object.values(s.mentions).reduce((a, b) => a + b, 0));
  const inVoice = useVoice((s) => Boolean(s.connectedChannelId));

  const slot = state.routes.length ? width / state.routes.length : 0;

  useEffect(() => {
    x.value = withSpring(state.index * slot, spring);
  }, [state.index, slot, x]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 12), alignItems: 'center' }}
    >
      <Glass radius={radii.pill} intensity={85} strong style={{ width: '88%', maxWidth: 420 }}>
        <View
          style={{ height: DOCK_HEIGHT, flexDirection: 'row' }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        >
          {slot > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[{ position: 'absolute', top: 8, bottom: 8, width: slot, alignItems: 'center' }, indicator]}
            >
              <View
                style={[
                  {
                    width: '76%',
                    height: '100%',
                    borderRadius: radii.pill,
                    backgroundColor: 'rgba(0,229,255,0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(0,229,255,0.35)',
                  },
                  glow(colors.cyan, 12, 0.35),
                ]}
              />
            </Animated.View>
          ) : null}

          {state.routes.map((route, index) => {
            const tab = TABS[route.name] ?? { icon: 'circle' as IconName, label: route.name };
            const focused = state.index === index;
            const color = focused ? colors.cyan : colors.textMuted;

            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            return (
              <Touchable
                key={route.key}
                onPress={onPress}
                onLongPress={route.name === 'index' ? openWofi : undefined}
                haptic="select"
                scaleTo={0.9}
                accessibilityLabel={tab.label}
                style={{ flex: 1 }}
              >
                <View className="h-full items-center justify-center gap-0.5">
                  <View>
                    <Icon name={tab.icon} size={20} color={color} />
                    <View style={{ position: 'absolute', top: -7, right: -12 }}>
                      {route.name === 'dms' ? <Badge count={dmUnread} tone="mention" /> : null}
                      {route.name === 'index' ? <Badge count={mentions} tone="mention" /> : null}
                      {route.name === 'voice' && inVoice ? <Dot color={colors.lime} /> : null}
                    </View>
                  </View>
                  <Text className="font-mono text-[9px] uppercase" style={{ color, letterSpacing: 1 }}>
                    {tab.label}
                  </Text>
                </View>
              </Touchable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}
