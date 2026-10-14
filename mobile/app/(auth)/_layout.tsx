import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/store/auth';

export default function AuthLayout() {
  const user = useAuth((s) => s.user);
  const onboarded = useAuth((s) => s.onboarded);
  // Con sesión y servidor elegido, el login no tiene nada que hacer.
  if (user && onboarded) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }} />;
}
