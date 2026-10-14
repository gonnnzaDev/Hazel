import { useEffect } from 'react';

import { getSocket, type MockWorld } from '@/api/socket';
import { cannedReplies } from '@/mocks/messages';
import { ME_ID } from '@/mocks/users';
import { onMessageSent, useMessages } from '@/store/messages';
import { useNet } from '@/store/net';
import { usePeople } from '@/store/people';
import { useServers } from '@/store/servers';
import { useSocial } from '@/store/social';

/**
 * Lo que el socket de prueba necesita saber para inventar actividad creíble:
 * en qué canales hay gente y quién puede escribir en cada uno.
 */
const world: MockWorld = {
  channels() {
    return useServers
      .getState()
      .servers.flatMap((server) =>
        server.channels
          .filter((c) => c.type === 'text')
          .map((c) => ({
            channelId: c.id,
            authorIds: server.members.map((m) => m.userId).filter((id) => id !== ME_ID),
          })),
      );
  },
  authorsFor(channelId) {
    if (channelId.startsWith('dm-')) {
      const dm = useSocial.getState().dms.find((d) => d.id === channelId);
      return dm ? [dm.userId] : [];
    }
    if (channelId.startsWith('t-')) {
      const thread = useMessages.getState().threads.find((t) => t.id === channelId);
      if (thread) return world.authorsFor(thread.channelId);
    }
    const server = useServers.getState().servers.find((s) => s.channels.some((c) => c.id === channelId));
    return server ? server.members.map((m) => m.userId).filter((id) => id !== ME_ID) : [];
  },
  cannedReplies,
};

/**
 * Conecta el socket mientras haya sesión y vuelca sus eventos en los stores.
 * Se monta una sola vez, en app/_layout.tsx.
 */
export function useRealtime(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket(world, () => null);

    const unsubscribe = socket.subscribe((event) => {
      switch (event.type) {
        case 'status':
          useNet.getState().setStatus(event.status);
          break;
        case 'latency':
          useNet.getState().pushLatency(event.ms);
          break;
        case 'message.created':
          useMessages.getState().receive(event.message);
          break;
        case 'typing.start':
          useMessages.getState().setTyping(event.channelId, event.userId, true);
          break;
        case 'typing.stop':
          useMessages.getState().setTyping(event.channelId, event.userId, false);
          break;
        case 'presence.update':
          usePeople.getState().setPresence(event.userId, event.presence);
          break;
      }
    });
    const stopForwarding = onMessageSent((message) => socket.send({ type: 'message.sent', message }));

    socket.connect();
    return () => {
      stopForwarding();
      unsubscribe();
      socket.disconnect();
    };
  }, [enabled]);
}
