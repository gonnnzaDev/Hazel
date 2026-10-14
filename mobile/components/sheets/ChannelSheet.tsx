import * as Clipboard from 'expo-clipboard';
import { View } from 'react-native';

import { findChannel, useServers } from '@/store/servers';
import { useUi } from '@/store/ui';

import { ActionRow } from '../ui/ActionRow';
import { Sheet } from '../ui/Sheet';

/** Opciones de un canal (mantener apretado en la lista). */
export function ChannelSheet({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const muted = useServers((s) => Boolean(s.muted[channelId]));
  const found = findChannel(channelId);
  const { toast, openSheet } = useUi.getState();
  if (!found) return null;
  const { server, channel } = found;
  const prefix = channel.type === 'voice' ? '🔊 ' : '#';

  return (
    <Sheet title={`${prefix}${channel.name}`} subtitle={server.name} onClose={onClose}>
      <View className="px-2 pt-2">
        <ActionRow
          icon="check-circle"
          label="Marcar como leído"
          onPress={() => {
            useServers.getState().markRead(channelId);
            toast('Canal al día', 'success');
            onClose();
          }}
        />
        <ActionRow
          icon={muted ? 'bell' : 'bell-off'}
          label={muted ? 'Activar notificaciones' : 'Silenciar canal'}
          description={muted ? 'Vuelve a sumar no leídos' : 'Solo te avisa si te mencionan'}
          onPress={() => {
            useServers.getState().toggleMute(channelId);
            onClose();
          }}
        />
        <ActionRow
          icon="link"
          label="Copiar enlace"
          description={`recop://${server.inviteCode}/${channel.name}`}
          onPress={() => {
            void Clipboard.setStringAsync(`recop://${server.inviteCode}/${channel.name}`);
            toast('Enlace copiado', 'success');
            onClose();
          }}
        />
        <ActionRow icon="users" label="Miembros" onPress={() => openSheet({ kind: 'members', serverId: server.id })} />
      </View>
    </Sheet>
  );
}
