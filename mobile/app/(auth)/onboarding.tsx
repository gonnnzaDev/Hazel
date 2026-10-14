import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Server } from '@/api/types';
import { Glass } from '@/components/ui/Glass';
import { Icon } from '@/components/ui/Icon';
import { NeonButton } from '@/components/ui/NeonButton';
import { Touchable } from '@/components/ui/Touchable';
import { useHaptics } from '@/hooks/useHaptics';
import { discoverableServers } from '@/mocks/servers';
import { useAuth } from '@/store/auth';
import { useServers } from '@/store/servers';
import { colors, radii, spring } from '@/theme';

/** Elegir con qué servidor arrancar después de registrarse. */
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const joined = useServers((s) => s.servers);
  const options = [...joined, ...discoverableServers.filter((d) => !joined.some((s) => s.id === d.id))];
  const [selected, setSelected] = useState(options[0]?.id ?? '');

  const start = () => {
    const server = options.find((s) => s.id === selected);
    if (!server) return;
    const store = useServers.getState();
    if (store.servers.some((s) => s.id === server.id)) store.selectServer(server.id);
    else store.joinByInvite(server.inviteCode);
    useAuth.getState().completeOnboarding();
    haptics.success();
    router.replace('/(tabs)');
  };

  return (
    <View className="flex-1" style={{ paddingTop: insets.top + 24 }}>
      <View className="gap-1 px-5 pb-4">
        <Text className="font-mono text-xs text-cyan">paso 2 de 2</Text>
        <Text className="font-mono-bold text-2xl text-ink">Elegí tu primer servidor</Text>
        <Text className="font-sans text-sm text-muted">Después podés sumarte a más con un código de invitación.</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 24 }}>
        {options.map((server, i) => (
          <Animated.View
            key={server.id}
            entering={FadeInDown.delay(i * 70).springify().damping(spring.damping).stiffness(spring.stiffness)}
          >
            <ServerCard server={server} selected={server.id === selected} onPress={() => setSelected(server.id)} />
          </Animated.View>
        ))}
      </ScrollView>
      <View className="px-5" style={{ paddingBottom: insets.bottom + 16 }}>
        <NeonButton label="Entrar al servidor" icon="arrow-right" solid onPress={start} disabled={!selected} />
      </View>
    </View>
  );
}

function ServerCard({ server, selected, onPress }: { server: Server; selected: boolean; onPress: () => void }) {
  return (
    <Touchable onPress={onPress} haptic="select" scaleTo={0.98}>
      <Glass radius={radii.lg} glowColor={selected ? server.accent : undefined}>
        <LinearGradient colors={server.banner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 52 }} />
        <View className="flex-row items-center gap-3 p-3">
          <View
            className="h-12 w-12 items-center justify-center rounded-2xl"
            style={{ marginTop: -34, backgroundColor: colors.baseRaised, borderWidth: 1, borderColor: server.accent }}
          >
            <Text className="font-mono-bold text-xl" style={{ color: server.accent }}>
              {server.icon}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="font-mono-bold text-[15px] text-ink">{server.name}</Text>
            <Text className="font-sans text-xs text-muted" numberOfLines={2}>
              {server.description}
            </Text>
            <Text className="pt-1 font-mono text-[10px] text-dim">
              {server.members.length} miembros · {server.channels.length} canales
            </Text>
          </View>
          <Icon name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? server.accent : colors.textDim} />
        </View>
      </Glass>
    </Touchable>
  );
}
