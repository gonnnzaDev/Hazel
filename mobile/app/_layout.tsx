import '../global.css';
import '@/lib/nativewind';

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { DarkTheme, SplashScreen, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View, type View as ViewType } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Background } from '@/components/Background';
import { BootScreen } from '@/components/BootScreen';
import { SheetHost } from '@/components/sheets/SheetHost';
import { Toasts } from '@/components/Toasts';
import { BlurTargetContext } from '@/components/ui/Glass';
import { WaybarHeader } from '@/components/WaybarHeader';
import { useWofiShortcut, WofiSearch } from '@/components/WofiSearch';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/store/auth';
import { useHydrated } from '@/store/storage';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

// Las pantallas son transparentes: el fondo animado se ve detrás de todo.
const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent', primary: colors.cyan, text: colors.text },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const hydrated = useHydrated(useAuth);
  const user = useAuth((s) => s.user);
  const segments = useSegments();
  const blurTarget = useRef<ViewType>(null);
  const [booted, setBooted] = useState(false);
  const ready = fontsLoaded && hydrated;

  useRealtime(Boolean(user));
  useWofiShortcut();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.base }} />;

  const inAuth = segments[0] === '(auth)';
  const showChrome = Boolean(user) && !inAuth;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.base }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <BlurTargetContext.Provider value={blurTarget}>
            <StatusBar style="light" />
            <Background targetRef={blurTarget} />

            {showChrome ? <WaybarHeader /> : null}
            <View style={{ flex: 1 }}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: 'transparent' },
                  animation: 'fade',
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="channel/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="dm/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="thread/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="mentions" options={{ animation: 'slide_from_bottom' }} />
              </Stack>
            </View>

            {showChrome ? <WofiSearch /> : null}
            <SheetHost />
            <Toasts />
            {booted ? null : <BootScreen onDone={() => setBooted(true)} />}
          </BlurTargetContext.Provider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
