import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Message } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Markdown } from '@/components/Markdown';
import { Glass } from '@/components/ui/Glass';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Touchable } from '@/components/ui/Touchable';
import { UserAvatar } from '@/components/UserAvatar';
import { relative } from '@/lib/format';
import { mentionsOfMe, useMessages } from '@/store/messages';
import { getUser, useUser } from '@/store/people';
import { findChannel, useServers } from '@/store/servers';
import { colors, radii, spring } from '@/theme';

interface Where {
  label: string;
  icon: IconName;
  href: `/channel/${string}` | `/dm/${string}` | `/thread/${string}`;
}

/** De dónde viene una mención y a qué pantalla lleva tocarla. */
function whereIs(channelId: string, threads: { id: string; name: string }[]): Where | null {
  if (channelId.startsWith('dm-')) {
    const user = getUser(channelId.slice(3));
    return { label: `@${user?.username ?? 'dm'}`, icon: 'at-sign', href: `/dm/${channelId}` };
  }
  const thread = threads.find((t) => t.id === channelId);
  if (thread) return { label: `hilo · ${thread.name}`, icon: 'git-branch', href: `/thread/${channelId}` };
  const found = findChannel(channelId);
  if (!found) return null;
  return { label: `${found.server.name} · #${found.channel.name}`, icon: 'hash', href: `/channel/${channelId}` };
}

/** Todo lo que te nombró con @, de lo más nuevo a lo más viejo. */
export default function Mentions() {
  const insets = useSafeAreaInsets();
  const byChannel = useMessages((s) => s.byChannel);
  const threads = useMessages((s) => s.threads);
  useServers((s) => s.servers); // recalcular si cambian los canales
  const mentions = useMemo(() => mentionsOfMe(byChannel), [byChannel]);

  return (
    <View className="flex-1">
      <View className="px-2 pb-1">
        <Glass radius={radii.md}>
          <View className="h-14 flex-row items-center gap-2 px-2">
            <Touchable onPress={() => router.back()} accessibilityLabel="Volver" hitSlop={8}>
              <View className="h-9 w-9 items-center justify-center rounded-xl">
                <Icon name="chevron-left" size={22} color={colors.text} />
              </View>
            </Touchable>
            <Icon name="at-sign" size={18} color={colors.warning} />
            <Text className="flex-1 font-mono-bold text-[15px] text-ink">menciones</Text>
            <Text className="pr-2 font-mono text-[11px] text-dim">{mentions.length}</Text>
          </View>
        </Glass>
      </View>

      <FlatList
        data={mentions}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={<EmptyState icon="at-sign" title="Nadie te nombró todavía" text="Cuando alguien escriba @tu_usuario, aparece acá." />}
        renderItem={({ item, index }) => <MentionCard message={item} index={index} where={whereIs(item.channelId, threads)} />}
      />
    </View>
  );
}

function MentionCard({ message, index, where }: { message: Message; index: number; where: Where | null }) {
  const author = useUser(message.authorId);
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 50).springify().damping(spring.damping).stiffness(spring.stiffness)}>
      <Touchable onPress={() => (where ? router.push(where.href) : undefined)} scaleTo={0.98} disabled={!where}>
        <Glass radius={radii.lg}>
          <View className="gap-2 p-3" style={{ borderLeftWidth: 2, borderLeftColor: colors.warning }}>
            <View className="flex-row items-center gap-1.5">
              <Icon name={where?.icon ?? 'hash'} size={12} color={colors.textDim} />
              <Text className="flex-1 font-mono text-[11px] text-dim" numberOfLines={1}>
                {where?.label ?? 'canal borrado'}
              </Text>
              <Text className="font-mono text-[10px] text-dim">{relative(message.createdAt)}</Text>
            </View>
            <View className="flex-row gap-3">
              <UserAvatar user={author} size={34} />
              <View className="flex-1 gap-0.5">
                <Text className="font-sans-semibold text-[14px] text-ink">{author?.displayName ?? 'Alguien'}</Text>
                <Markdown content={message.content} />
              </View>
            </View>
          </View>
        </Glass>
      </Touchable>
    </Animated.View>
  );
}
