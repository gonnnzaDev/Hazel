import { router } from 'expo-router';
import { memo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import type { Message, Server } from '@/api/types';
import { clock, stamp } from '@/lib/format';
import { plainText } from '@/lib/markdown';
import { ME_ID } from '@/mocks/users';
import { findMessage, SYSTEM_ID, useMessages } from '@/store/messages';
import { displayName, useUser } from '@/store/people';
import { topRole } from '@/store/servers';
import { useUi } from '@/store/ui';
import { colors, spring } from '@/theme';

import { Markdown } from './Markdown';
import { RoleBadge } from './RoleBadge';
import { Icon } from './ui/Icon';
import { Touchable } from './ui/Touchable';
import { UserAvatar } from './UserAvatar';

interface MessageItemProps {
  message: Message;
  /** Mismo autor que el anterior y hace poco: va sin avatar ni encabezado. */
  grouped: boolean;
  server?: Server;
  /** Para animar solo lo que acaba de llegar. */
  isNew: boolean;
  /** Es el mensaje que abrió el hilo que se está viendo: sin el acceso al hilo. */
  isThreadParent?: boolean;
}

/**
 * Un mensaje: avatar, nombre con el color de su rol más alto, badge del rol,
 * respuesta citada, markdown, reacciones y el acceso a su hilo.
 */
export const MessageItem = memo(function MessageItem({ message, grouped, server, isNew, isThreadParent = false }: MessageItemProps) {
  const author = useUser(message.authorId);
  const openSheet = useUi((s) => s.openSheet);
  const role = topRole(server, message.authorId);
  const mentionsMe = message.mentions.includes(ME_ID) && message.authorId !== ME_ID;

  if (message.system || message.authorId === SYSTEM_ID) return <SystemMessage message={message} />;

  const onLongPress = () => openSheet({ kind: 'message', messageId: message.id, channelId: message.channelId });
  const nameColor = role && role.position > 1 ? role.color : colors.text;

  return (
    <Animated.View
      entering={isNew ? FadeInDown.springify().damping(spring.damping).stiffness(spring.stiffness) : undefined}
      style={[
        { paddingHorizontal: 12, paddingTop: grouped ? 2 : 10, paddingBottom: 2 },
        mentionsMe ? { backgroundColor: 'rgba(255,176,32,0.07)', borderLeftWidth: 2, borderLeftColor: colors.warning } : null,
      ]}
    >
      <Touchable onLongPress={onLongPress} haptic="none" scaleTo={0.99}>
        {/* La opacidad va adentro: en el Animated.View la pisaría la animación de entrada. */}
        <View style={message.pending ? { opacity: 0.5 } : undefined}>
          {message.replyToId ? <ReplyPreview channelId={message.channelId} messageId={message.replyToId} /> : null}
          <View className="flex-row gap-3">
            {grouped ? (
              <View style={{ width: 38, alignItems: 'center', paddingTop: 3 }}>
                <Text className="font-mono text-[9px] text-dim">{clock(new Date(message.createdAt))}</Text>
              </View>
            ) : (
              <Touchable onPress={() => openSheet({ kind: 'profile', userId: message.authorId })} haptic="select">
                <UserAvatar user={author} size={38} />
              </Touchable>
            )}

            <View className="flex-1 gap-1">
              {grouped ? null : (
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Text
                    className="font-sans-semibold text-[15px]"
                    style={{ color: nameColor }}
                    onPress={() => openSheet({ kind: 'profile', userId: message.authorId })}
                  >
                    {author?.displayName ?? 'alguien'}
                  </Text>
                  {author?.bot ? (
                    <View className="rounded px-1" style={{ backgroundColor: colors.purple }}>
                      <Text className="font-mono-bold text-[9px] text-ink">BOT</Text>
                    </View>
                  ) : null}
                  {role && role.position > 1 && !author?.bot ? <RoleBadge role={role} compact /> : null}
                  <Text className="font-mono text-[10px] text-dim">{stamp(message.createdAt)}</Text>
                </View>
              )}
              <Markdown content={message.content} />
              {message.reactions.length ? <Reactions message={message} /> : null}
              {message.threadId && !isThreadParent ? <ThreadLink threadId={message.threadId} /> : null}
            </View>
          </View>
        </View>
      </Touchable>
    </Animated.View>
  );
});

function SystemMessage({ message }: { message: Message }) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(spring.damping)} className="px-3 py-1.5">
      <View
        className="gap-1 rounded-xl px-3 py-2"
        style={{ borderWidth: 1, borderColor: 'rgba(168,85,247,0.35)', backgroundColor: 'rgba(168,85,247,0.08)' }}
      >
        <Text className="font-mono text-[10px] uppercase tracking-widest text-purple">› recop · solo vos lo ves</Text>
        <Markdown content={message.content} />
      </View>
    </Animated.View>
  );
}

function ReplyPreview({ channelId, messageId }: { channelId: string; messageId: string }) {
  const original = findMessage(channelId, messageId);
  return (
    <View className="mb-0.5 ml-4 flex-row items-center gap-1.5">
      <View
        style={{
          width: 22,
          height: 10,
          marginTop: 8,
          borderTopLeftRadius: 6,
          borderLeftWidth: 2,
          borderTopWidth: 2,
          borderColor: colors.borderStrong,
        }}
      />
      {original ? (
        <>
          <Text className="font-sans-semibold text-xs text-muted">@{displayName(original.authorId)}</Text>
          <Text className="flex-1 font-sans text-xs text-dim" numberOfLines={1}>
            {plainText(original.content, displayName)}
          </Text>
        </>
      ) : (
        <Text className="font-sans text-xs italic text-dim">mensaje original no disponible</Text>
      )}
    </View>
  );
}

function Reactions({ message }: { message: Message }) {
  const toggleReaction = useMessages((s) => s.toggleReaction);
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {message.reactions.map((reaction) => {
        const mine = reaction.userIds.includes(ME_ID);
        return (
          <Touchable
            key={reaction.emoji}
            onPress={() => toggleReaction(message.channelId, message.id, reaction.emoji)}
            haptic="select"
            scaleTo={0.9}
          >
            <View
              className="flex-row items-center gap-1 rounded-lg px-2 py-0.5"
              style={{
                borderWidth: 1,
                borderColor: mine ? 'rgba(0,229,255,0.6)' : colors.border,
                backgroundColor: mine ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
              }}
            >
              <Text style={{ fontSize: 13 }}>{reaction.emoji}</Text>
              <Text className="font-mono text-[11px]" style={{ color: mine ? colors.cyan : colors.textMuted }}>
                {reaction.userIds.length}
              </Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}

function ThreadLink({ threadId }: { threadId: string }) {
  const thread = useMessages((s) => s.threads.find((t) => t.id === threadId));
  const count = useMessages((s) => s.byChannel[threadId]?.length ?? 0);
  if (!thread) return null;
  return (
    <Touchable onPress={() => router.push(`/thread/${threadId}`)} scaleTo={0.97}>
      <View
        className="flex-row items-center gap-2 self-start rounded-xl px-2.5 py-1.5"
        style={{ borderWidth: 1, borderColor: 'rgba(168,85,247,0.4)', backgroundColor: 'rgba(168,85,247,0.08)' }}
      >
        <Icon name="git-branch" size={13} color={colors.purple} />
        <Text className="font-mono text-xs text-ink">{thread.name}</Text>
        <Text className="font-mono text-[11px] text-purple">
          {count} {count === 1 ? 'mensaje' : 'mensajes'} →
        </Text>
      </View>
    </Touchable>
  );
}
