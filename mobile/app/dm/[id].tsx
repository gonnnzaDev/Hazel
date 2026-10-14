import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/components/ChatScreen';

/** Un mensaje directo. El id es `dm-<userId>`. */
export default function DmRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen kind="dm" channelId={id} />;
}
