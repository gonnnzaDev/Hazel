import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/components/ChatScreen';

/** Un canal de texto o de anuncios de un servidor. */
export default function ChannelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen kind="channel" channelId={id} />;
}
