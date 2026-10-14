import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { RichPresence } from '@/components/RichPresence';
import { ActionRow } from '@/components/ui/ActionRow';
import { Badge } from '@/components/ui/Badge';
import { Glass } from '@/components/ui/Glass';
import { Touchable } from '@/components/ui/Touchable';
import { UserAvatar } from '@/components/UserAvatar';
import { CpuMonitor } from '@/components/widgets/CpuMonitor';
import { NetMonitor } from '@/components/widgets/NetMonitor';
import { useDockSpace } from '@/hooks/useDockSpace';
import { mentionsOfMe, useMessages } from '@/store/messages';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { useVoice } from '@/store/voice';
import { colors, radii, spring } from '@/theme';

const PRESENCE_LABEL = { online: 'En línea', idle: 'Ausente', dnd: 'No molestar', offline: 'Invisible' } as const;

/** Tu perfil, los widgets del sistema y los ajustes. */
export default function Profile() {
  const dockSpace = useDockSpace();
  const user = useAuth((s) => s.user);
  const mentions = useMessages((s) => mentionsOfMe(s.byChannel).length);
  const openSheet = useUi((s) => s.openSheet);

  if (!user) return null;

  const enter = (i: number) => FadeInDown.delay(i * 60).springify().damping(spring.damping).stiffness(spring.stiffness);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: dockSpace + 56 }}>
      <Animated.View entering={enter(0)}>
        <Glass radius={radii.lg} glowColor={colors.purple}>
          <LinearGradient colors={user.banner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 96 }} />
          <View className="px-4 pb-4">
            <View className="-mt-11 flex-row items-end justify-between">
              <View style={{ padding: 4, borderRadius: 52, backgroundColor: colors.baseRaised }}>
                <UserAvatar user={user} size={84} showPresence ringBackground={colors.baseRaised} />
              </View>
              <Touchable onPress={() => openSheet({ kind: 'status' })}>
                <View className="rounded-xl border border-line px-3 py-1.5">
                  <Text className="font-mono text-[11px] text-cyan">editar estado</Text>
                </View>
              </Touchable>
            </View>
            <View className="gap-0.5 pt-2">
              <Text className="font-mono-bold text-2xl text-ink">{user.displayName}</Text>
              <Text className="font-mono text-xs text-muted">
                @{user.username} · {PRESENCE_LABEL[user.presence]}
              </Text>
              <Touchable onPress={() => openSheet({ kind: 'status' })} haptic="select">
                <Text className="pt-2 font-sans text-sm" style={{ color: user.customStatus ? colors.text : colors.textDim }}>
                  💬 {user.customStatus ?? 'Agregá un estado personalizado'}
                </Text>
              </Touchable>
            </View>
          </View>
        </Glass>
      </Animated.View>

      {user.activity ? (
        <Animated.View entering={enter(1)}>
          <RichPresence activity={user.activity} />
        </Animated.View>
      ) : null}

      <Animated.View entering={enter(2)} className="flex-row" style={{ gap: 10 }}>
        <NetMonitor />
        <CpuMonitor />
      </Animated.View>

      <Animated.View entering={enter(3)}>
        <Glass radius={radii.lg}>
          <View className="p-1">
            <ActionRow
              icon="at-sign"
              label="Menciones"
              description="Donde te nombraron con @"
              onPress={() => router.push('/mentions')}
              right={<Badge count={mentions} tone="mention" />}
            />
            <ActionRow icon="smile" label="Estado y presencia" onPress={() => openSheet({ kind: 'status' })} />
            <ActionRow icon="sliders" label="Ajustes" description="Vibración, partículas, backend" onPress={() => openSheet({ kind: 'settings' })} />
            <ActionRow
              icon="log-out"
              label="Cerrar sesión"
              danger
              onPress={() => {
                useVoice.getState().leave();
                useAuth.getState().logout();
                router.replace('/login');
              }}
            />
          </View>
        </Glass>
      </Animated.View>
    </ScrollView>
  );
}
