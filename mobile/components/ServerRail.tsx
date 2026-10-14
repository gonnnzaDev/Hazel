import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { Server } from '@/api/types';
import { serverBadges, useServers } from '@/store/servers';
import { useUi } from '@/store/ui';
import { colors, glow, radii, spring } from '@/theme';

import { Badge, Dot } from './ui/Badge';
import { Glass } from './ui/Glass';
import { Icon } from './ui/Icon';
import { Touchable } from './ui/Touchable';

const SIZE = 46;

/**
 * Dock vertical flotante con los servidores, a la izquierda. El activo tiene
 * una barra neón al costado y brilla; los demás muestran sus no leídos.
 */
export function ServerRail({ bottomSpace }: { bottomSpace: number }) {
  const { servers, activeServerId, unread, mentions, muted, selectServer } = useServers();
  const openSheet = useUi((s) => s.openSheet);

  return (
    <Glass radius={radii.lg + 4} style={{ width: SIZE + 20, flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', gap: 10, paddingVertical: 12, paddingBottom: bottomSpace }}
      >
        {servers.map((server) => {
          const badges = serverBadges(server, unread, mentions, muted);
          return (
            <RailItem
              key={server.id}
              server={server}
              active={server.id === activeServerId}
              unread={badges.unread}
              mentions={badges.mentions}
              onPress={() => selectServer(server.id)}
            />
          );
        })}

        <View style={{ width: 24, height: 1, backgroundColor: colors.borderStrong, marginVertical: 2 }} />

        <Touchable onPress={() => openSheet({ kind: 'server-actions' })} accessibilityLabel="Crear o unirse a un servidor">
          <View
            style={{
              width: SIZE,
              height: SIZE,
              borderRadius: radii.md,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: `${colors.lime}66`,
              backgroundColor: `${colors.lime}0d`,
            }}
          >
            <Icon name="plus" size={20} color={colors.lime} />
          </View>
        </Touchable>
      </ScrollView>
    </Glass>
  );
}

interface RailItemProps {
  server: Server;
  active: boolean;
  unread: number;
  mentions: number;
  onPress: () => void;
}

function RailItem({ server, active, unread, mentions, onPress }: RailItemProps) {
  const bar = useSharedValue(active ? 1 : unread ? 0.35 : 0);

  useEffect(() => {
    bar.value = withSpring(active ? 1 : unread ? 0.35 : 0, spring);
  }, [active, unread, bar]);

  const barStyle = useAnimatedStyle(() => ({
    height: 6 + bar.value * 28,
    opacity: bar.value === 0 ? 0 : 1,
  }));

  const isEmoji = !/^[\w◆]{1,3}$/.test(server.icon);

  return (
    <View style={{ width: SIZE + 20, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            width: 4,
            borderTopRightRadius: 3,
            borderBottomRightRadius: 3,
            backgroundColor: active ? server.accent : colors.text,
          },
          active ? glow(server.accent, 8, 0.9) : null,
          barStyle,
        ]}
      />
      <Touchable onPress={onPress} haptic="select" scaleTo={0.9} accessibilityLabel={server.name}>
        <View
          style={[
            {
              width: SIZE,
              height: SIZE,
              borderRadius: active ? radii.md : SIZE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? `${server.accent}22` : 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: active ? server.accent : colors.border,
            },
            active ? glow(server.accent, 12, 0.6) : null,
          ]}
        >
          <Text
            className={isEmoji ? 'font-sans' : 'font-mono-bold'}
            style={{ fontSize: isEmoji ? 20 : 16, color: active ? server.accent : colors.text }}
          >
            {server.icon}
          </Text>
        </View>
      </Touchable>
      <View style={{ position: 'absolute', right: 4, bottom: -2 }}>
        {mentions ? <Badge count={mentions} tone="mention" /> : unread && !active ? <Dot color={colors.cyan} size={8} /> : null}
      </View>
    </View>
  );
}
