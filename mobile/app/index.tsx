import { Redirect } from 'expo-router';

import { useAuth } from '@/store/auth';

/** Decide la primera pantalla: login, elegir servidor o la app. */
export default function Index() {
  const user = useAuth((s) => s.user);
  const onboarded = useAuth((s) => s.onboarded);
  if (!user) return <Redirect href="/login" />;
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
