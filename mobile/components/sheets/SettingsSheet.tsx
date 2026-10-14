import Constants from 'expo-constants';
import { Switch, Text, View } from 'react-native';

import { useNet } from '@/store/net';
import { useUi } from '@/store/ui';
import { colors } from '@/theme';

import { ActionRow } from '../ui/ActionRow';
import { Sheet } from '../ui/Sheet';

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(0,229,255,0.45)' }}
      thumbColor={value ? colors.cyan : colors.textMuted}
    />
  );
}

/** Ajustes de la app. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useUi((s) => s.settings);
  const setSetting = useUi((s) => s.setSetting);
  const status = useNet((s) => s.status);
  const realBackend = Boolean(process.env.EXPO_PUBLIC_RECOP_WS_URL);

  return (
    <Sheet title="ajustes" subtitle={`v${Constants.expoConfig?.version ?? '0.1.0'}`} onClose={onClose}>
      <View className="px-2 pt-2">
        <ActionRow
          icon="smartphone"
          label="Vibración al tocar"
          description="Respuesta háptica en botones y gestos"
          right={<Toggle value={settings.haptics} onChange={(v) => setSetting('haptics', v)} />}
        />
        <ActionRow
          icon="star"
          label="Partículas de fondo"
          description="Apagalas si tu teléfono va lento"
          right={<Toggle value={settings.particles} onChange={(v) => setSetting('particles', v)} />}
        />
        <ActionRow
          icon="server"
          label="Backend"
          description={realBackend ? 'Recop real (EXPO_PUBLIC_RECOP_WS_URL)' : 'Modo demo: datos de prueba, sin servidor'}
          right={
            <Text className="font-mono text-[11px]" style={{ color: status === 'online' ? colors.lime : colors.warning }}>
              {status}
            </Text>
          }
        />
      </View>
      <Text className="px-5 pt-3 font-mono text-[10px] text-dim">
        recop mobile · expo · hypr mode
      </Text>
    </Sheet>
  );
}
