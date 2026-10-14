import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/components/ChatScreen';

/** Un hilo que cuelga de un mensaje de un canal. */
export default function ThreadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen kind="thread" channelId={id} />;
}
