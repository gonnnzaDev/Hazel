import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { Glass } from '@/components/ui/Glass';
import { Icon, type IconName } from '@/components/ui/Icon';
import { NeonButton } from '@/components/ui/NeonButton';
import { Touchable } from '@/components/ui/Touchable';
import { UserAvatar } from '@/components/UserAvatar';
import { VoiceTile } from '@/components/VoiceTile';
import { NetMonitor } from '@/components/widgets/NetMonitor';
import { useDockSpace } from '@/hooks/useDockSpace';
import { useHaptics } from '@/hooks/useHaptics';
import { useNow } from '@/hooks/useNow';
import { duration } from '@/lib/format';
import { ME_ID } from '@/mocks/users';
import { useNet } from '@/store/net';
import { getUser } from '@/store/people';
import { findChannel, useServers } from '@/store/servers';
import { useVoice } from '@/store/voice';
import { colors, glow, radii, spring } from '@/theme';

/** Ping de cada participante: el de la red más una diferencia fija por persona. */
function peerLatency(base: number | null, userId: string): number | null {
  if (base === null) return null;
  if (userId === ME_ID) return base;
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return base + (hash % 35);
}

/** Voz: el HUD de la sala si estás conectado, o los canales para entrar. */
export default function Voice() {
  const connectedChannelId = useVoice((s) => s.connectedChannelId);
  return connectedChannelId ? <Room channelId={connectedChannelId} /> : <Lobby />;
}

function Room({ channelId }: { channelId: string }) {
  const dockSpace = useDockSpace();
  const haptics = useHaptics();
  const now = useNow(1000);
  const { rooms, speaking, muted, deafened, connecting, joinedAt, toggleMute, toggleDeafen, leave } = useVoice();
  const latency = useNet((s) => s.latency);
  const found = findChannel(channelId);
  const participants = [ME_ID, ...(rooms[channelId] ?? [])];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: dockSpace + 56 }}>
      <Animated.View entering={FadeIn.duration(220)}>
        <Glass radius={radii.lg} glowColor={connecting ? colors.warning : colors.lime}>
          <View className="gap-1 p-4">
            <View className="flex-row items-center gap-2">
              <View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: connecting ? colors.warning : colors.lime }, glow(colors.lime, 6, 0.9)]} />
              <Text className="font-mono text-[11px] uppercase tracking-widest" style={{ color: connecting ? colors.warning : colors.lime }}>
                {connecting ? 'negociando conexión…' : 'voz conectada'}
              </Text>
              <Text className="ml-auto font-mono text-[12px] text-ink">{joinedAt ? duration(joinedAt, now) : '--:--'}</Text>
            </View>
            <Text className="font-mono-bold text-2xl text-ink">🔊 {found?.channel.name ?? 'canal'}</Text>
            <View className="flex-row items-center gap-3">
              <Text className="font-sans text-xs text-muted">{found?.server.name}</Text>
              <Text className="font-mono text-[11px] text-dim">· {participants.length} en la sala</Text>
              <Text className="font-mono text-[11px] text-dim">· p2p webrtc (mock)</Text>
            </View>
          </View>
        </Glass>
      </Animated.View>

      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {participants.map((userId, i) => (
          <VoiceTile
            key={userId}
            userId={userId}
            index={i}
            speaking={Boolean(speaking[userId])}
            muted={userId === ME_ID ? muted : false}
            deafened={userId === ME_ID ? deafened : false}
            latency={peerLatency(latency, userId)}
          />
        ))}
      </View>

      <Animated.View entering={FadeInDown.springify().damping(spring.damping).stiffness(spring.stiffness)}>
        <Glass radius={radii.pill} strong>
          <View className="flex-row items-center justify-around px-3 py-3">
            <ControlButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'activar' : 'silenciar'} active={muted} color={colors.danger} onPress={() => { haptics.press(); toggleMute(); }} />
            <ControlButton icon={deafened ? 'volume-x' : 'headphones'} label={deafened ? 'escuchar' : 'ensordecer'} active={deafened} color={colors.danger} onPress={() => { haptics.press(); toggleDeafen(); }} />
            <ControlButton icon="phone-off" label="salir" active color={colors.danger} solid onPress={() => { haptics.warn(); leave(); }} />
          </View>
        </Glass>
      </Animated.View>

      <View className="flex-row" style={{ gap: 10 }}>
        <NetMonitor />
      </View>
    </ScrollView>
  );
}

function ControlButton({
  icon,
  label,
  active,
  color,
  solid = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  color: string;
  solid?: boolean;
  onPress: () => void;
}) {
  const fg = solid ? colors.base : active ? color : colors.text;
  return (
    <Touchable onPress={onPress} haptic="none" scaleTo={0.88} accessibilityLabel={label}>
      <View className="items-center gap-1">
        <View
          style={[
            {
              width: 54,
              height: 54,
              borderRadius: 27,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: solid ? color : active ? `${color}22` : 'rgba(255,255,255,0.06)',
              borderWidth: 1,
              borderColor: active || solid ? `${color}aa` : colors.border,
            },
            solid || active ? glow(color, 14, 0.6) : null,
          ]}
        >
          <Icon name={icon} size={22} color={fg} />
        </View>
        <Text className="font-mono text-[10px] text-muted">{label}</Text>
      </View>
    </Touchable>
  );
}

function Lobby() {
  const dockSpace = useDockSpace();
  const servers = useServers((s) => s.servers);
  const rooms = useVoice((s) => s.rooms);
  const join = useVoice((s) => s.join);

  const voiceChannels = useMemo(
    () => servers.flatMap((server) => server.channels.filter((c) => c.type === 'voice').map((channel) => ({ server, channel }))),
    [servers],
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: dockSpace + 56 }}>
      <Text className="px-1 font-mono-bold text-xl text-ink">
        <Text className="text-lime">~/</Text>voz
      </Text>
      <Text className="px-1 font-sans text-sm text-muted">El audio va directo entre las compus de la sala: el servidor solo las presenta.</Text>

      {voiceChannels.length === 0 ? <EmptyState icon="headphones" title="No hay canales de voz" /> : null}

      {servers.map((server) => {
        const channels = voiceChannels.filter((v) => v.server.id === server.id);
        if (!channels.length) return null;
        return (
          <View key={server.id}>
            <SectionLabel>{server.name}</SectionLabel>
            {channels.map(({ channel }, i) => {
              const people = rooms[channel.id] ?? [];
              return (
                <Animated.View key={channel.id} entering={FadeInDown.delay(i * 60).springify().damping(spring.damping).stiffness(spring.stiffness)}>
                  <Glass radius={radii.lg} style={{ marginBottom: 8 }} glowColor={people.length ? colors.lime : undefined}>
                    <View className="flex-row items-center gap-3 p-3">
                      <View className="h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: 'rgba(191,255,0,0.1)' }}>
                        <Icon name="volume-2" size={20} color={people.length ? colors.lime : colors.textMuted} />
                      </View>
                      <View className="flex-1 gap-1">
                        <Text className="font-mono-bold text-[15px] text-ink">{channel.name}</Text>
                        {people.length ? (
                          <View className="flex-row items-center">
                            {people.slice(0, 5).map((id, idx) => (
                              <View key={id} style={{ marginLeft: idx ? -8 : 0 }}>
                                <UserAvatar user={getUser(id)} size={22} />
                              </View>
                            ))}
                            <Text className="ml-2 font-mono text-[11px] text-muted">{people.length} adentro</Text>
                          </View>
                        ) : (
                          <Text className="font-mono text-[11px] text-dim">vacío · sé el primero</Text>
                        )}
                      </View>
                      <NeonButton label="conectar" icon="phone" tone="lime" compact onPress={() => void join(channel.id)} />
                    </View>
                  </Glass>
                </Animated.View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}
