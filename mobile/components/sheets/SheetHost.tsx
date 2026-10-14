import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import { useUi } from '@/store/ui';

import { ChannelSheet } from './ChannelSheet';
import { MembersSheet } from './MembersSheet';
import { MessageSheet } from './MessageSheet';
import { ProfileSheet } from './ProfileSheet';
import { ServerActionsSheet } from './ServerActionsSheet';
import { SettingsSheet } from './SettingsSheet';
import { StatusSheet } from './StatusSheet';

/**
 * Muestra el bottom sheet que pida cualquier pantalla con
 * `useUi.getState().openSheet(...)`. Hay uno solo a la vez.
 */
export function SheetHost() {
  const sheet = useUi((s) => s.sheet);
  const close = useUi((s) => s.closeSheet);

  // El botón atrás de Android cierra el sheet antes de navegar.
  useEffect(() => {
    if (!sheet) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [sheet, close]);

  if (!sheet) return null;

  // La `key` hace que cambiar de sheet monte uno nuevo, con su animación de entrada.
  switch (sheet.kind) {
    case 'profile':
      return <ProfileSheet key={`p-${sheet.userId}`} userId={sheet.userId} onClose={close} />;
    case 'channel':
      return <ChannelSheet key={`c-${sheet.channelId}`} channelId={sheet.channelId} onClose={close} />;
    case 'message':
      return <MessageSheet key={`m-${sheet.messageId}`} channelId={sheet.channelId} messageId={sheet.messageId} onClose={close} />;
    case 'members':
      return <MembersSheet key={`mb-${sheet.serverId}`} serverId={sheet.serverId} onClose={close} />;
    case 'server-actions':
      return <ServerActionsSheet key="sa" onClose={close} />;
    case 'status':
      return <StatusSheet key="st" onClose={close} />;
    case 'settings':
      return <SettingsSheet key="se" onClose={close} />;
  }
}
