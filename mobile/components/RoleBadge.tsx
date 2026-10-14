import { Text, View } from 'react-native';

import type { Role } from '@/api/types';

import { Icon } from './ui/Icon';

/** Chip de rol con su color neón, para mensajes y la lista de miembros. */
export function RoleBadge({ role, compact = false }: { role: Role; compact?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: compact ? 5 : 7,
        paddingVertical: compact ? 1 : 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: `${role.color}55`,
        backgroundColor: `${role.color}18`,
      }}
    >
      {role.badge ? <Icon name={role.badge} size={compact ? 9 : 11} color={role.color} /> : null}
      <Text className="font-mono" style={{ color: role.color, fontSize: compact ? 9 : 10, letterSpacing: 0.4 }}>
        {role.name.toUpperCase()}
      </Text>
    </View>
  );
}
