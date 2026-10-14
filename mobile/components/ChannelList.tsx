import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { Channel, Server } from '@/api/types';
import { getUser } from '@/store/people';
import { useServers } from '@/store/servers';
import { useUi } from '@/store/ui';
import { useVoice } from '@/store/voice';
import { ME_ID } from '@/mocks/users';
import { colors, spring } from '@/theme';

import { Badge } from './ui/Badge';
import { Icon, type IconName } from './ui/Icon';
import { Touchable } from './ui/Touchable';
import { UserAvatar } from './UserAvatar';

export const CHANNEL_ICONS: Record<Channel['type'], IconName> = {
  text: 'hash',
  voice: 'volume-2',
  announcement: 'radio',
};

/**
 * Canales de un servidor agrupados por categoría. Las categorías se pliegan
 * con un resorte; los de voz muestran quién está adentro y quién habla.
 */
export function ChannelList({ server }: { server: Server }) {
  const collapsed = useServers((s) => s.collapsed);
  const toggleCategory = useServers((s) => s.toggleCategory);

  return (
    <View className="gap-2">
      {server.categories.map((category, i) => {
        const channels = server.channels.filter((c) => c.categoryId === category.id);
        const isCollapsed = Boolean(collapsed[category.id]);
        return (
          <Animated.View
            key={category.id}
            entering={FadeInDown.delay(i * 60)
              .springify()
              .damping(spring.damping)
              .stiffness(spring.stiffness)}
          >
            <Touchable onPress={() => toggleCategory(category.id)} haptic="select" scaleTo={0.98}>
              <View className="flex-row items-center gap-1.5 px-1 py-1.5">
                <Chevron open={!isCollapsed} />
                <Text className="font-mono text-[11px] uppercase tracking-widest text-dim">{category.name}</Text>
                <View className="ml-1 h-px flex-1" style={{ backgroundColor: colors.border }} />
              </View>
            </Touchable>
            {isCollapsed
              ? // Plegada: igual se ve el canal abierto o con menciones, como en Discord.
                channels
                  .filter((c) => (useServers.getState().mentions[c.id] ?? 0) > 0)
                  .map((channel) => <ChannelRow key={channel.id} channel={channel} />)
              : channels.map((channel) => <ChannelRow key={channel.id} channel={channel} />)}
          </Animated.View>
        );
      })}
    </View>
  );
}

function Chevron({ open }: { open: boolean }) {
  const rotation = useSharedValue(open ? 90 : 0);
  useEffect(() => {
    rotation.value = withSpring(open ? 90 : 0, spring);
  }, [open, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon name="chevron-right" size={12} color={colors.textDim} />
    </Animated.View>
  );
}

function ChannelRow({ channel }: { channel: Channel }) {
  const unread = useServers((s) => s.unread[channel.id] ?? 0);
  const mentions = useServers((s) => s.mentions[channel.id] ?? 0);
  const muted = useServers((s) => Boolean(s.muted[channel.id]));
  const openSheet = useUi((s) => s.openSheet);
  const connectedHere = useVoice((s) => s.connectedChannelId === channel.id);

  const isVoice = channel.type === 'voice';
  const hot = (unread > 0 && !muted) || mentions > 0;
  const color = connectedHere ? colors.lime : hot ? colors.text : muted ? colors.textDim : colors.textMuted;

  const onPress = () => {
    if (isVoice) {
      void useVoice.getState().join(channel.id);
      router.navigate('/voice');
    } else {
      router.push(`/channel/${channel.id}`);
    }
  };

  return (
    <View>
      <Touchable
        onPress={onPress}
        onLongPress={() => openSheet({ kind: 'channel', channelId: channel.id })}
        scaleTo={0.98}
        accessibilityLabel={channel.name}
      >
        <View
          className="flex-row items-center gap-2 rounded-xl px-2.5 py-2"
          style={connectedHere ? { backgroundColor: 'rgba(191,255,0,0.08)' } : undefined}
        >
          {hot && !isVoice ? (
            <View style={{ position: 'absolute', left: -4, width: 3, height: 14, borderRadius: 2, backgroundColor: colors.text }} />
          ) : null}
          <Icon name={CHANNEL_ICONS[channel.type]} size={16} color={color} />
          <Text
            className={hot ? 'flex-1 font-mono-bold text-[14px]' : 'flex-1 font-mono text-[14px]'}
            style={{ color }}
            numberOfLines={1}
          >
            {channel.name}
          </Text>
          {muted ? <Icon name="bell-off" size={13} color={colors.textDim} /> : null}
          {mentions ? <Badge count={mentions} tone="mention" /> : unread && !muted && !isVoice ? <Badge count={unread} /> : null}
        </View>
      </Touchable>
      {isVoice ? <VoiceOccupants channelId={channel.id} /> : null}
    </View>
  );
}

function VoiceOccupants({ channelId }: { channelId: string }) {
  const room = useVoice((s) => s.rooms[channelId]);
  const connectedHere = useVoice((s) => s.connectedChannelId === channelId);
  const speaking = useVoice((s) => s.speaking);
  const muted = useVoice((s) => s.muted);
  const people = [...(connectedHere ? [ME_ID] : []), ...(room ?? [])];
  if (!people.length) return null;

  return (
    <View className="gap-1 pb-1 pl-9">
      {people.map((id) => {
        const user = getUser(id);
        return (
          <View key={id} className="flex-row items-center gap-2 py-0.5">
            <UserAvatar user={user} size={20} speaking={connectedHere && Boolean(speaking[id])} />
            <Text className="flex-1 font-sans text-[13px] text-muted" numberOfLines={1}>
              {user?.displayName ?? id}
            </Text>
            {id === ME_ID && muted ? <Icon name="mic-off" size={12} color={colors.danger} /> : null}
          </View>
        );
      })}
    </View>
  );
}
