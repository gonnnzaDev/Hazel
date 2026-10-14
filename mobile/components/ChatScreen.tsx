import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Message, Server } from '@/api/types';
import { dayLabel, isSameDay } from '@/lib/format';
import { ME_ID } from '@/mocks/users';
import { hasOlder, useMessages, visibleMessages } from '@/store/messages';
import { useUser } from '@/store/people';
import { findChannel, useServers } from '@/store/servers';
import { useUi } from '@/store/ui';
import { colors, radii } from '@/theme';

import { CHANNEL_ICONS } from './ChannelList';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';
import { TypingIndicator } from './TypingIndicator';
import { Glass } from './ui/Glass';
import { Icon, type IconName } from './ui/Icon';
import { Touchable } from './ui/Touchable';
import { UserAvatar } from './UserAvatar';

const GROUP_WINDOW_MS = 5 * 60_000;

const PRESENCE_LABEL = { online: 'en línea', idle: 'ausente', dnd: 'no molestar', offline: 'desconectado' } as const;

interface ChatTarget {
  title: string;
  subtitle?: string;
  icon: IconName;
  server?: Server;
  placeholder: string;
  /** Si no se puede escribir, por qué. */
  readOnlyReason?: string;
  welcome: string;
  welcomeDetail?: string;
  /** Mensaje que abrió el hilo, para mostrarlo arriba de todo. */
  parent?: Message;
  actions: { icon: IconName; label: string; onPress: () => void }[];
}

/** Arma título, ícono y acciones según sea un canal, un DM o un hilo. */
function useTarget(kind: 'channel' | 'dm' | 'thread', channelId: string): ChatTarget | null {
  const servers = useServers((s) => s.servers);
  const thread = useMessages((s) => s.threads.find((t) => t.id === channelId));
  const parent = useMessages((s) => (thread ? s.byChannel[thread.channelId]?.find((m) => m.id === thread.parentMessageId) : undefined));
  const dmUser = useUser(kind === 'dm' ? channelId.replace(/^dm-/, '') : null);
  const openSheet = useUi((s) => s.openSheet);

  return useMemo(() => {
    if (kind === 'dm') {
      if (!dmUser) return null;
      return {
        title: dmUser.displayName,
        subtitle: dmUser.customStatus ?? PRESENCE_LABEL[dmUser.presence],
        icon: 'at-sign',
        placeholder: `Mensaje para @${dmUser.username}`,
        welcome: dmUser.displayName,
        welcomeDetail: `Este es el comienzo de tu conversación con @${dmUser.username}.`,
        actions: [{ icon: 'user', label: 'Perfil', onPress: () => openSheet({ kind: 'profile', userId: dmUser.id }) }],
      };
    }

    const lookupId = kind === 'thread' ? thread?.channelId : channelId;
    const found = lookupId ? findChannel(lookupId) : null;
    if (!found) return null;
    const { server, channel } = found;

    if (kind === 'thread' && thread) {
      return {
        title: thread.name,
        subtitle: `hilo en #${channel.name}`,
        icon: 'git-branch',
        server,
        placeholder: `Responder en ${thread.name}`,
        welcome: thread.name,
        welcomeDetail: `Un hilo de #${channel.name}. Lo que se dice acá no llena el canal.`,
        parent,
        actions: [],
      };
    }

    const isOwner = server.ownerId === ME_ID;
    return {
      title: channel.name,
      subtitle: channel.topic,
      icon: CHANNEL_ICONS[channel.type],
      server,
      placeholder: `Escribí en #${channel.name}`,
      readOnlyReason:
        channel.type === 'announcement' && !isOwner ? 'Solo quien administra el servidor publica en los anuncios.' : undefined,
      welcome: `Bienvenido a #${channel.name}`,
      welcomeDetail: channel.topic ?? `Este es el comienzo del canal #${channel.name} en ${server.name}.`,
      actions: [
        { icon: 'users', label: 'Miembros', onPress: () => openSheet({ kind: 'members', serverId: server.id }) },
        { icon: 'more-vertical', label: 'Opciones', onPress: () => openSheet({ kind: 'channel', channelId: channel.id }) },
      ],
    };
    // `servers` está en las dependencias para recalcular si cambian los canales.
  }, [kind, channelId, thread, parent, dmUser, openSheet, servers]);
}

/** El chat de un canal, un DM o un hilo. */
export function ChatScreen({ kind, channelId }: { kind: 'channel' | 'dm' | 'thread'; channelId: string }) {
  const insets = useSafeAreaInsets();
  const target = useTarget(kind, channelId);
  const all = useMessages((s) => s.byChannel[channelId]);
  const loaded = useMessages((s) => s.loaded[channelId]);
  const loadingOlder = useMessages((s) => Boolean(s.loadingOlder[channelId]));
  const loadOlder = useMessages((s) => s.loadOlder);
  const setOpenChannel = useMessages((s) => s.setOpenChannel);
  const openedAt = useRef(Date.now());

  useFocusEffect(
    useCallback(() => {
      setOpenChannel(channelId);
      return () => setOpenChannel(null);
    }, [channelId, setOpenChannel]),
  );

  // La lista va invertida (lo nuevo abajo), así que los datos van del más nuevo al más viejo.
  const data = useMemo(() => [...visibleMessages(all, loaded)].reverse(), [all, loaded]);
  const more = hasOlder(all, loaded);

  if (!target) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-8">
        <Icon name="alert-triangle" size={28} color={colors.warning} />
        <Text className="text-center font-mono text-sm text-muted">Este canal ya no existe.</Text>
        <Touchable onPress={() => router.back()}>
          <Text className="font-mono text-sm text-cyan">← volver</Text>
        </Touchable>
      </View>
    );
  }

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const older = data[index + 1];
    const newDay = !older || !isSameDay(older.createdAt, item.createdAt);
    const grouped =
      !newDay &&
      !!older &&
      older.authorId === item.authorId &&
      !older.system &&
      !item.replyToId &&
      item.createdAt - older.createdAt < GROUP_WINDOW_MS;
    return (
      <View>
        {newDay ? <DayDivider timestamp={item.createdAt} /> : null}
        <MessageItem message={item} grouped={grouped} server={target.server} isNew={item.createdAt > openedAt.current} />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Cabecera */}
      <View className="px-2 pb-1">
        <Glass radius={radii.md}>
          <View className="h-14 flex-row items-center gap-2 px-2">
            <Touchable onPress={() => router.back()} accessibilityLabel="Volver" hitSlop={8}>
              <View className="h-9 w-9 items-center justify-center rounded-xl">
                <Icon name="chevron-left" size={22} color={colors.text} />
              </View>
            </Touchable>
            {kind === 'dm' ? <DmAvatar userId={channelId.replace(/^dm-/, '')} /> : <Icon name={target.icon} size={18} color={colors.cyan} />}
            <View className="flex-1">
              <Text className="font-mono-bold text-[15px] text-ink" numberOfLines={1}>
                {target.title}
              </Text>
              {target.subtitle ? (
                <Text className="font-sans text-[11px] text-dim" numberOfLines={1}>
                  {target.subtitle}
                </Text>
              ) : null}
            </View>
            {target.actions.map((action) => (
              <Touchable key={action.label} onPress={action.onPress} accessibilityLabel={action.label} hitSlop={6}>
                <View className="h-9 w-9 items-center justify-center rounded-xl">
                  <Icon name={action.icon} size={18} color={colors.textMuted} />
                </View>
              </Touchable>
            ))}
          </View>
        </Glass>
      </View>

      {/* Mensajes */}
      <Animated.View entering={FadeIn.duration(220)} className="flex-1">
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          onEndReached={() => void loadOlder(channelId)}
          onEndReachedThreshold={0.3}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingVertical: 8 }}
          ListFooterComponent={
            more ? (
              <View className="items-center py-4">
                {loadingOlder ? <ActivityIndicator color={colors.cyan} /> : <Text className="font-mono text-[11px] text-dim">↑ deslizá para cargar más</Text>}
              </View>
            ) : (
              <Welcome target={target} />
            )
          }
        />
      </Animated.View>

      <TypingIndicator channelId={channelId} />
      <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        {target.readOnlyReason ? (
          <View className="mx-3 mb-2 flex-row items-center gap-2 rounded-2xl border border-line px-4 py-3">
            <Icon name="lock" size={14} color={colors.textDim} />
            <Text className="flex-1 font-sans text-xs text-dim">{target.readOnlyReason}</Text>
          </View>
        ) : (
          <Composer channelId={channelId} placeholder={target.placeholder} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function DmAvatar({ userId }: { userId: string }) {
  const user = useUser(userId);
  return <UserAvatar user={user} size={30} showPresence ringBackground={colors.baseRaised} />;
}

function DayDivider({ timestamp }: { timestamp: number }) {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3">
      <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
      <Text className="font-mono text-[10px] uppercase tracking-widest text-dim">{dayLabel(timestamp)}</Text>
      <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
    </View>
  );
}

function Welcome({ target }: { target: ChatTarget }) {
  return (
    <View className="gap-2 px-4 pb-3 pt-10">
      <View
        className="h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.35)' }}
      >
        <Icon name={target.icon} size={26} color={colors.cyan} />
      </View>
      <Text className="font-mono-bold text-2xl text-ink">{target.welcome}</Text>
      {target.welcomeDetail ? <Text className="font-sans text-sm text-muted">{target.welcomeDetail}</Text> : null}
      {target.parent ? (
        <View className="mt-2 rounded-2xl border border-line py-1" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
          <MessageItem message={target.parent} grouped={false} server={target.server} isNew={false} isThreadParent />
        </View>
      ) : null}
    </View>
  );
}
