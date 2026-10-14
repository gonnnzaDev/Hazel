import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ChannelList } from '@/components/ChannelList';
import { EmptyState } from '@/components/EmptyState';
import { ServerBanner } from '@/components/ServerBanner';
import { ServerRail } from '@/components/ServerRail';
import { NeonButton } from '@/components/ui/NeonButton';
import { useDockSpace } from '@/hooks/useDockSpace';
import { useServers } from '@/store/servers';
import { useUi } from '@/store/ui';
import { gaps } from '@/theme';

/**
 * Home: el dock de servidores a la izquierda y, al lado, el servidor activo
 * con sus canales. Dos "ventanas" en mosaico, separadas por el gap.
 */
export default function Home() {
  const dockSpace = useDockSpace();
  const server = useServers((s) => s.servers.find((sv) => sv.id === s.activeServerId) ?? s.servers[0]);
  const openSheet = useUi((s) => s.openSheet);

  return (
    <View className="flex-1 flex-row" style={{ gap: gaps.inner, paddingHorizontal: gaps.inner, paddingTop: 4 }}>
      <View style={{ paddingBottom: 8 }}>
        <ServerRail bottomSpace={dockSpace} />
      </View>
      <View className="flex-1">
        {server ? (
          <Animated.View key={server.id} entering={FadeIn.duration(220)} className="flex-1">
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: dockSpace + 56 }}>
              <ServerBanner server={server} />
              <ChannelList server={server} />
            </ScrollView>
          </Animated.View>
        ) : (
          <EmptyState icon="server" title="Sin servidores" text="Unite a uno con un código o desplegá el tuyo.">
            <NeonButton label="Agregar servidor" icon="plus" onPress={() => openSheet({ kind: 'server-actions' })} compact />
          </EmptyState>
        )}
      </View>
    </View>
  );
}
