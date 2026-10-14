import { Linking, ScrollView, Text, View } from 'react-native';

import { parseMarkdown, type Inline } from '@/lib/markdown';
import { ME_ID } from '@/mocks/users';
import { displayName } from '@/store/people';
import { useUi } from '@/store/ui';
import { colors, fonts, radii } from '@/theme';

const BASE = { color: colors.text, fontFamily: fonts.sans, fontSize: 15, lineHeight: 21 } as const;

function InlineSpan({ token }: { token: Inline }) {
  switch (token.kind) {
    case 'text':
      return <Text>{token.text}</Text>;
    case 'bold':
      return <Text style={{ fontFamily: fonts.sansBold }}>{token.text}</Text>;
    case 'italic':
      return <Text style={{ fontStyle: 'italic' }}>{token.text}</Text>;
    case 'strike':
      return <Text style={{ textDecorationLine: 'line-through', color: colors.textMuted }}>{token.text}</Text>;
    case 'code':
      return (
        <Text style={{ fontFamily: fonts.monoRegular, fontSize: 13, color: colors.cyan, backgroundColor: 'rgba(0,229,255,0.08)' }}>
          {` ${token.text} `}
        </Text>
      );
    case 'mention': {
      const mine = token.userId === ME_ID;
      return (
        <Text
          onPress={() => useUi.getState().openSheet({ kind: 'profile', userId: token.userId })}
          style={{
            fontFamily: fonts.sansSemibold,
            color: mine ? colors.warning : colors.cyan,
            backgroundColor: mine ? 'rgba(255,176,32,0.16)' : 'rgba(0,229,255,0.12)',
          }}
        >
          {` @${displayName(token.userId)} `}
        </Text>
      );
    }
    case 'link':
      return (
        <Text
          onPress={() => void Linking.openURL(token.url)}
          style={{ color: colors.cyan, textDecorationLine: 'underline' }}
        >
          {token.url}
        </Text>
      );
  }
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((token, i) => (
        <InlineSpan key={i} token={token} />
      ))}
    </>
  );
}

/** Markdown del chat: párrafos, citas y bloques de código con su lenguaje. */
export function Markdown({ content, dim = false }: { content: string; dim?: boolean }) {
  const blocks = parseMarkdown(content);
  const base = dim ? { ...BASE, color: colors.textMuted } : BASE;

  return (
    <View className="gap-1.5">
      {blocks.map((block, i) => {
        if (block.kind === 'code') {
          return (
            <View
              key={i}
              style={{
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: 'rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              <View className="flex-row items-center justify-between border-b border-line px-3 py-1">
                <Text className="font-mono text-[10px] uppercase tracking-widest text-purple">{block.lang || 'code'}</Text>
                <View className="flex-row gap-1">
                  {[colors.danger, colors.warning, colors.lime].map((c) => (
                    <View key={c} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c, opacity: 0.7 }} />
                  ))}
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={{ fontFamily: fonts.monoRegular, fontSize: 12, lineHeight: 18, color: colors.text, padding: 12 }}>
                  {block.code}
                </Text>
              </ScrollView>
            </View>
          );
        }
        if (block.kind === 'quote') {
          return (
            <View key={i} className="flex-row gap-2">
              <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.purple }} />
              <Text selectable style={[base, { flex: 1, color: colors.textMuted }]}>
                <Inlines inlines={block.inlines} />
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} selectable style={base}>
            <Inlines inlines={block.inlines} />
          </Text>
        );
      })}
    </View>
  );
}
