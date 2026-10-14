import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { Dock } from '@/components/Dock';
import { WofiFab } from '@/components/WofiSearch';
import { useDockSpace } from '@/hooks/useDockSpace';
import { useAuth } from '@/store/auth';

/** Las cuatro pestañas, con el dock flotante en vez de la barra de siempre. */
export default function TabsLayout() {
  const user = useAuth((s) => s.user);
  const onboarded = useAuth((s) => s.onboarded);
  const dockSpace = useDockSpace();

  if (!user) return <Redirect href="/login" />;
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <Dock {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' }, animation: 'shift' }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="dms" />
        <Tabs.Screen name="voice" />
        <Tabs.Screen name="profile" />
      </Tabs>
      <WofiFab bottom={dockSpace - 4} />
    </View>
  );
}
