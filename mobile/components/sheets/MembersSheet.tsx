import { ScrollView, Text, View } from 'react-native';

import type { Role, User } from '@/api/types';
import { getUser, usePeople } from '@/store/people';
import { topRole, useServers } from '@/store/servers';
import { useUi } from '@/store/ui';
import { colors } from '@/theme';

import { RoleBadge } from '../RoleBadge';
import { SectionLabel } from '../SectionLabel';
import { Sheet } from '../ui/Sheet';
import { Touchable } from '../ui/Touchable';
import { UserAvatar } from '../UserAvatar';

/** Miembros del servidor agrupados por su rol más alto, como en Discord. */
export function MembersSheet({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const server = useServers((s) => s.servers.find((sv) => sv.id === serverId));
  usePeople((s) => s.presence); // re-render cuando cambia la presencia de alguien
  const openSheet = useUi((s) => s.openSheet);
  if (!server) return null;

  const groups = new Map<string, { role: Role | undefined; people: User[] }>();
  const offline: User[] = [];
  for (const member of server.members) {
    const user = getUser(member.userId);
    if (!user) continue;
    if (user.presence === 'offline') {
      offline.push(user);
      continue;
    }
    const role = topRole(server, member.userId);
    const key = role?.id ?? 'none';
    const group = groups.get(key) ?? { role, people: [] };
    group.people.push(user);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => (b.role?.position ?? 0) - (a.role?.position ?? 0));

  const row = (user: User, dim = false) => {
    const role = topRole(server, user.id);
    return (
      <Touchable key={user.id} onPress={() => openSheet({ kind: 'profile', userId: user.id })} scaleTo={0.98}>
        <View className="flex-row items-center gap-3 rounded-xl px-2 py-2" style={{ opacity: dim ? 0.45 : 1 }}>
          <UserAvatar user={user} size={34} showPresence ringBackground={colors.baseRaised} />
          <View className="flex-1">
            <Text className="font-sans-semibold text-[14px]" style={{ color: role && role.position > 1 ? role.color : colors.text }}>
              {user.displayName}
            </Text>
            {user.customStatus ? (
              <Text className="font-sans text-[11px] text-dim" numberOfLines={1}>
                {user.customStatus}
              </Text>
            ) : null}
          </View>
          {role && role.position > 1 ? <RoleBadge role={role} compact /> : null}
        </View>
      </Touchable>
    );
  };

  return (
    <Sheet title="miembros" subtitle={`${server.name} · ${server.members.length}`} onClose={onClose}>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {sorted.map((group) => (
          <View key={group.role?.id ?? 'none'}>
            <SectionLabel right={String(group.people.length)}>{group.role?.name ?? 'En línea'}</SectionLabel>
            {group.people.map((u) => row(u))}
          </View>
        ))}
        {offline.length ? (
          <View>
            <SectionLabel right={String(offline.length)}>Desconectados</SectionLabel>
            {offline.map((u) => row(u, true))}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
