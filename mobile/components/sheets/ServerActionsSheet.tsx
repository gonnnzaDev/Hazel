import { useState } from 'react';
import { Text, View } from 'react-native';

import { useHaptics } from '@/hooks/useHaptics';
import { useServers } from '@/store/servers';
import { useUi } from '@/store/ui';
import { colors } from '@/theme';

import { Field } from '../ui/Field';
import { NeonButton } from '../ui/NeonButton';
import { Sheet } from '../ui/Sheet';
import { Touchable } from '../ui/Touchable';

/** Unirse a un servidor con un código o crear uno nuevo. */
export function ServerActionsSheet({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const haptics = useHaptics();
  const toast = useUi((s) => s.toast);

  const join = () => {
    try {
      const server = useServers.getState().joinByInvite(code);
      haptics.success();
      toast(`Entraste a ${server.name}`, 'success');
      onClose();
    } catch (e) {
      haptics.warn();
      setError(e instanceof Error ? e.message : 'No se pudo entrar');
    }
  };

  const create = () => {
    try {
      const server = useServers.getState().createServer(name, icon);
      haptics.success();
      toast(`${server.name} está en línea · /${server.inviteCode}`, 'success');
      onClose();
    } catch (e) {
      haptics.warn();
      setError(e instanceof Error ? e.message : 'No se pudo crear');
    }
  };

  return (
    <Sheet title="servidores" subtitle="unirse o desplegar uno nuevo" onClose={onClose}>
      <View className="gap-4 px-4 pt-3">
        <View className="flex-row rounded-2xl border border-line p-1">
          {(['join', 'create'] as const).map((m) => (
            <Touchable
              key={m}
              haptic="select"
              style={{ flex: 1 }}
              onPress={() => {
                setMode(m);
                setError(null);
              }}
            >
              <View
                className="items-center rounded-xl py-2"
                style={mode === m ? { backgroundColor: 'rgba(0,229,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.4)' } : undefined}
              >
                <Text className="font-mono text-[12px]" style={{ color: mode === m ? colors.cyan : colors.textMuted }}>
                  {m === 'join' ? 'unirse' : 'crear'}
                </Text>
              </View>
            </Touchable>
          ))}
        </View>

        {mode === 'join' ? (
          <>
            <Field
              label="código de invitación"
              icon="link"
              placeholder="recop-dev"
              value={code}
              onChangeText={(t) => {
                setCode(t);
                setError(null);
              }}
              onSubmitEditing={join}
              error={error}
              hint="Pegá el código o el enlace que te pasaron. Probá con recop-dev."
            />
            <NeonButton label="Unirse" icon="log-in" solid onPress={join} disabled={!code.trim()} />
          </>
        ) : (
          <>
            <Field
              label="nombre"
              icon="server"
              placeholder="Casa de Luis"
              value={name}
              onChangeText={(t) => {
                setName(t);
                setError(null);
              }}
              error={error}
            />
            <Field label="ícono" icon="smile" placeholder="🔥 (opcional)" value={icon} onChangeText={setIcon} maxLength={2} />
            <NeonButton label="Desplegar servidor" icon="zap" tone="lime" solid onPress={create} disabled={name.trim().length < 2} />
          </>
        )}
      </View>
    </Sheet>
  );
}
