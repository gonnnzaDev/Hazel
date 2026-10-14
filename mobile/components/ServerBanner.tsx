import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';

import type { Server } from '@/api/types';
import { usePeople } from '@/store/people';
import { useUi } from '@/store/ui';
import { usersById } from '@/mocks/users';
import { colors, radii } from '@/theme';

import { Glass } from './ui/Glass';
import { Icon } from './ui/Icon';
import { Touchable } from './ui/Touchable';

/** Cabecera de un servidor: banner con degradé, nombre, gente en línea y acciones. */
export function ServerBanner({ server }: { server: Server }) {
  const { openSheet, toast } = useUi.getState();
  const presence = usePeople((s) => s.presence);
  const online = server.members.filter((m) => {
    const p = presence[m.userId] ?? usersById[m.userId]?.presence ?? 'online';
    return p !== 'offline';
  }).length;

  return (
    <Glass radius={radii.lg} glowColor={server.accent}>
      <LinearGradient
        colors={[server.banner[0], server.banner[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ height: 74, justifyContent: 'flex-end', padding: 12 }}
      >
        {/* El emoji va primero: si quedara arriba de los botones, se comería los toques. */}
        <Text className="self-start font-sans text-3xl" pointerEvents="none">
          {/^[\w◆]{1,3}$/.test(server.icon) ? '' : server.icon}
        </Text>
        <View className="absolute right-3 top-3 flex-row gap-2">
          <Touchable onPress={() => openSheet({ kind: 'members', serverId: server.id })} accessibilityLabel="Miembros">
            <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
              <Icon name="users" size={15} color={colors.text} />
            </View>
          </Touchable>
          <Touchable
            onPress={() => {
              void Clipboard.setStringAsync(`recop://${server.inviteCode}`);
              toast(`Invitación copiada: recop://${server.inviteCode}`, 'success');
            }}
            accessibilityLabel="Invitar"
          >
            <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
              <Icon name="user-plus" size={15} color={colors.text} />
            </View>
          </Touchable>
        </View>
      </LinearGradient>
      <View className="gap-1 p-3">
        <Text className="font-mono-bold text-[17px] text-ink" numberOfLines={1}>
          {server.name}
        </Text>
        <Text className="font-sans text-xs text-muted" numberOfLines={2}>
          {server.description}
        </Text>
        <View className="mt-1 flex-row items-center gap-3">
          <View className="flex-row items-center gap-1.5">
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.lime }} />
            <Text className="font-mono text-[11px] text-muted">{online} en línea</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textDim }} />
            <Text className="font-mono text-[11px] text-muted">{server.members.length} miembros</Text>
          </View>
          <Text className="font-mono text-[11px] text-dim">/{server.inviteCode}</Text>
        </View>
      </View>
    </Glass>
  );
}
