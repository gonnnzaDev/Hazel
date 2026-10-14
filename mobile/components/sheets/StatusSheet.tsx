import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Presence } from '@/api/types';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { colors, presenceColors } from '@/theme';

import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { NeonButton } from '../ui/NeonButton';
import { Sheet } from '../ui/Sheet';
import { Touchable } from '../ui/Touchable';

const OPTIONS: { value: Presence; label: string; description: string }[] = [
  { value: 'online', label: 'En línea', description: 'Te ven disponible' },
  { value: 'idle', label: 'Ausente', description: 'Estás pero no tanto' },
  { value: 'dnd', label: 'No molestar', description: 'Silencia las notificaciones' },
  { value: 'offline', label: 'Invisible', description: 'Te ven desconectado, pero podés usar todo' },
];

/** Presencia y estado personalizado. */
export function StatusSheet({ onClose }: { onClose: () => void }) {
  const user = useAuth((s) => s.user);
  const [status, setStatus] = useState(user?.customStatus ?? '');
  const toast = useUi((s) => s.toast);
  if (!user) return null;

  return (
    <Sheet title="estado" subtitle={`@${user.username}`} onClose={onClose}>
      <View className="gap-1 px-2 pt-2">
        {OPTIONS.map((option) => {
          const active = user.presence === option.value;
          return (
            <Touchable key={option.value} haptic="select" scaleTo={0.98} onPress={() => useAuth.getState().setPresence(option.value)}>
              <View
                className="flex-row items-center gap-3 rounded-2xl px-3 py-2.5"
                style={active ? { backgroundColor: 'rgba(255,255,255,0.05)' } : undefined}
              >
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: presenceColors[option.value] }} />
                <View className="flex-1">
                  <Text className="font-sans-medium text-[15px] text-ink">{option.label}</Text>
                  <Text className="font-sans text-xs text-dim">{option.description}</Text>
                </View>
                {active ? <Icon name="check" size={16} color={colors.cyan} /> : null}
              </View>
            </Touchable>
          );
        })}
      </View>
      <View className="gap-3 px-4 pt-3">
        <Field label="estado personalizado" icon="message-square" placeholder="¿En qué andás?" value={status} onChangeText={setStatus} maxLength={60} />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <NeonButton
              label="Borrar"
              tone="ghost"
              onPress={() => {
                useAuth.getState().setCustomStatus('');
                setStatus('');
              }}
            />
          </View>
          <View className="flex-1">
            <NeonButton
              label="Guardar"
              icon="check"
              solid
              onPress={() => {
                useAuth.getState().setCustomStatus(status);
                toast('Estado actualizado', 'success');
                onClose();
              }}
            />
          </View>
        </View>
      </View>
    </Sheet>
  );
}
