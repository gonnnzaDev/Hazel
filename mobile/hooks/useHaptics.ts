import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { useUi } from '@/store/ui';

/**
 * Vibraciones cortas al tocar. Respetan el ajuste de la persona y no hacen
 * nada en la web, donde no hay motor háptico.
 */
export function useHaptics() {
  const enabled = useUi((s) => s.settings.haptics) && Platform.OS !== 'web';
  return useMemo(
    () => ({
      tap: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      press: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      select: () => enabled && void Haptics.selectionAsync(),
      success: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      warn: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    }),
    [enabled],
  );
}
