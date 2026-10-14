import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { plainText } from '@/lib/markdown';
import { quickReactions } from '@/mocks/emojis';
import { ME_ID } from '@/mocks/users';
import { findMessage, useMessages } from '@/store/messages';
import { displayName } from '@/store/people';
import { useUi } from '@/store/ui';
import { colors } from '@/theme';

import { ActionRow } from '../ui/ActionRow';
import { Sheet } from '../ui/Sheet';
import { Touchable } from '../ui/Touchable';

/** Acciones sobre un mensaje: reaccionar, responder, abrir hilo, copiar, borrar. */
export function MessageSheet({ channelId, messageId, onClose }: { channelId: string; messageId: string; onClose: () => void }) {
  const message = useMessages((s) => s.byChannel[channelId]?.find((m) => m.id === messageId)) ?? findMessage(channelId, messageId);
  const { toggleReaction, openThread, deleteMessage } = useMessages.getState();
  const { setReplyTo, toast } = useUi.getState();
  if (!message) return null;

  const isThread = channelId.startsWith('t-');
  const isDm = channelId.startsWith('dm-');
  const mine = message.authorId === ME_ID;

  return (
    <Sheet title={`@${displayName(message.authorId)}`} subtitle={plainText(message.content, displayName).slice(0, 48)} onClose={onClose}>
      <View className="flex-row justify-between px-4 pb-2 pt-3">
        {quickReactions.map((emoji) => {
          const active = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(ME_ID));
          return (
            <Touchable
              key={emoji}
              haptic="select"
              scaleTo={0.85}
              onPress={() => {
                toggleReaction(channelId, messageId, emoji);
                onClose();
              }}
            >
              <View
                className="h-12 w-12 items-center justify-center rounded-2xl"
                style={{
                  borderWidth: 1,
                  borderColor: active ? colors.cyan : colors.border,
                  backgroundColor: active ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
                }}
              >
                <Text style={{ fontSize: 22 }}>{emoji}</Text>
              </View>
            </Touchable>
          );
        })}
      </View>
      <View className="px-2">
        <ActionRow
          icon="corner-up-left"
          label="Responder"
          onPress={() => {
            setReplyTo(channelId, messageId);
            onClose();
          }}
        />
        {!isThread && !isDm ? (
          <ActionRow
            icon="git-branch"
            label={message.threadId ? 'Ir al hilo' : 'Abrir un hilo'}
            description="Una conversación aparte, sin llenar el canal"
            onPress={() => {
              const threadId = openThread(channelId, messageId);
              onClose();
              router.push(`/thread/${threadId}`);
            }}
          />
        ) : null}
        <ActionRow
          icon="copy"
          label="Copiar texto"
          onPress={() => {
            void Clipboard.setStringAsync(plainText(message.content, displayName));
            toast('Texto copiado', 'success');
            onClose();
          }}
        />
        {mine ? (
          <ActionRow
            icon="trash-2"
            label="Borrar mensaje"
            danger
            onPress={() => {
              deleteMessage(channelId, messageId);
              toast('Mensaje borrado');
              onClose();
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}
