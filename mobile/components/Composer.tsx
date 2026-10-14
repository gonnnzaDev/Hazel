import { useMemo, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import type { User } from '@/api/types';
import { useHaptics } from '@/hooks/useHaptics';
import { slashCommands, type SlashCommand } from '@/mocks/commands';
import { emojiNames, emojis } from '@/mocks/emojis';
import { findMessage, useMessages } from '@/store/messages';
import { allUsers, displayName } from '@/store/people';
import { useUi } from '@/store/ui';
import { colors, fonts, glow, radii, spring } from '@/theme';

import { Glass } from './ui/Glass';
import { Icon } from './ui/Icon';
import { Touchable } from './ui/Touchable';
import { UserAvatar } from './UserAvatar';

type Suggestion =
  | { kind: 'command'; command: SlashCommand }
  | { kind: 'emoji'; name: string; char: string }
  | { kind: 'user'; user: User };

const MAX_LENGTH = 2000;

/** La última "palabra" del texto, si empieza con / : o @. */
function trailingToken(text: string): string | null {
  const match = text.match(/(?:^|\s)([/:@][^\s]*)$/);
  return match?.[1] ?? null;
}

function suggestionsFor(text: string): { title: string; items: Suggestion[] } | null {
  const token = trailingToken(text);
  if (!token) return null;
  const query = token.slice(1).toLowerCase();

  if (token.startsWith('/') && text.trimStart() === token) {
    const items = slashCommands.filter((c) => c.name.startsWith(query));
    return items.length ? { title: 'comandos', items: items.map((command) => ({ kind: 'command', command })) } : null;
  }
  if (token.startsWith(':') && query.length >= 1) {
    const starts = emojiNames.filter((n) => n.startsWith(query));
    const contains = emojiNames.filter((n) => !n.startsWith(query) && n.includes(query));
    const items = [...starts, ...contains].slice(0, 8);
    return items.length ? { title: 'emojis', items: items.map((name) => ({ kind: 'emoji', name, char: emojis[name] ?? '' })) } : null;
  }
  if (token.startsWith('@')) {
    const items = allUsers()
      .filter((u) => u.username.startsWith(query) || u.displayName.toLowerCase().startsWith(query))
      .slice(0, 6);
    return items.length ? { title: 'personas', items: items.map((user) => ({ kind: 'user', user })) } : null;
  }
  return null;
}

/**
 * Campo para escribir con autocompletado futurista: `/` para comandos, `:`
 * para emojis y `@` para mencionar. Enter (o el botón) envía.
 */
export function Composer({ channelId, placeholder }: { channelId: string; placeholder: string }) {
  const [text, setText] = useState('');
  const haptics = useHaptics();
  const send = useMessages((s) => s.send);
  const replyToId = useUi((s) => s.replyTo[channelId]);
  const setReplyTo = useUi((s) => s.setReplyTo);
  const replyTo = replyToId ? findMessage(channelId, replyToId) : undefined;

  const suggestions = useMemo(() => suggestionsFor(text), [text]);

  const apply = (s: Suggestion) => {
    haptics.select();
    const token = trailingToken(text) ?? '';
    const head = text.slice(0, text.length - token.length);
    if (s.kind === 'command') setText(`/${s.command.name} `);
    else if (s.kind === 'emoji') setText(`${head}${s.char} `);
    else setText(`${head}@${s.user.username} `);
  };

  const submit = () => {
    if (!text.trim()) return;
    haptics.tap();
    send(channelId, text);
    setText('');
  };

  const canSend = text.trim().length > 0;

  return (
    <View className="gap-2 px-3 pb-2">
      {suggestions ? (
        <Animated.View entering={FadeInDown.springify().damping(spring.damping).stiffness(spring.stiffness)} exiting={FadeOut.duration(120)}>
          <Glass strong radius={radii.md} glowColor={colors.purple}>
            <Text className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-widest text-purple">› {suggestions.title}</Text>
            {suggestions.items.map((s, i) => (
              <Touchable key={i} onPress={() => apply(s)} haptic="none" scaleTo={0.98}>
                <View className="flex-row items-center gap-3 px-3 py-2" style={i === 0 ? { backgroundColor: 'rgba(168,85,247,0.12)' } : undefined}>
                  {s.kind === 'command' ? (
                    <>
                      <Text className="font-mono-bold text-[13px] text-cyan">/{s.command.name}</Text>
                      {s.command.args ? <Text className="font-mono text-[12px] text-dim">{s.command.args}</Text> : null}
                      <Text className="flex-1 text-right font-sans text-[12px] text-muted" numberOfLines={1}>
                        {s.command.description}
                      </Text>
                    </>
                  ) : s.kind === 'emoji' ? (
                    <>
                      <Text style={{ fontSize: 18 }}>{s.char}</Text>
                      <Text className="font-mono text-[13px] text-ink">:{s.name}:</Text>
                    </>
                  ) : (
                    <>
                      <UserAvatar user={s.user} size={24} showPresence ringBackground={colors.baseRaised} />
                      <Text className="font-sans-medium text-[14px] text-ink">{s.user.displayName}</Text>
                      <Text className="font-mono text-[12px] text-dim">@{s.user.username}</Text>
                    </>
                  )}
                </View>
              </Touchable>
            ))}
          </Glass>
        </Animated.View>
      ) : null}

      <Glass radius={radii.lg} intensity={80}>
        {replyTo ? (
          <View className="flex-row items-center gap-2 border-b border-line px-3 py-1.5">
            <Icon name="corner-up-left" size={13} color={colors.cyan} />
            <Text className="flex-1 font-mono text-[11px] text-muted" numberOfLines={1}>
              respondiendo a <Text className="text-cyan">@{displayName(replyTo.authorId)}</Text>
            </Text>
            <Touchable onPress={() => setReplyTo(channelId, undefined)} accessibilityLabel="Cancelar respuesta" hitSlop={8}>
              <Icon name="x" size={14} color={colors.textMuted} />
            </Touchable>
          </View>
        ) : null}
        <View className="flex-row items-end gap-2 p-1.5 pl-3">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.textDim}
            selectionColor={colors.cyan}
            multiline
            maxLength={MAX_LENGTH}
            onKeyPress={(e) => {
              // En la web Enter envía y Shift+Enter agrega una línea. En el
              // celular Enter es salto de línea y se envía con el botón.
              if (Platform.OS !== 'web') return;
              const native = e.nativeEvent as { key: string; shiftKey?: boolean };
              if (native.key === 'Enter' && !native.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            style={{
              flex: 1,
              color: colors.text,
              fontFamily: fonts.sans,
              fontSize: 15,
              maxHeight: 120,
              minHeight: 38,
              paddingTop: 9,
              paddingBottom: 9,
              outlineWidth: 0, // sin el contorno del navegador en web
            }}
          />
          <Touchable onPress={submit} disabled={!canSend} scaleTo={0.88} accessibilityLabel="Enviar">
            <View
              style={[
                {
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: canSend ? colors.cyan : 'rgba(255,255,255,0.06)',
                },
                canSend ? glow(colors.cyan, 12, 0.7) : null,
              ]}
            >
              <Icon name="send" size={16} color={canSend ? colors.base : colors.textDim} />
            </View>
          </Touchable>
        </View>
      </Glass>
      {text.length > MAX_LENGTH - 200 ? (
        <Text className="text-right font-mono text-[10px] text-warning">{MAX_LENGTH - text.length} caracteres restantes</Text>
      ) : null}
    </View>
  );
}
