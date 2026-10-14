import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Alto del dock flotante de abajo. */
export const DOCK_HEIGHT = 64;

/** Espacio a dejar al final de una pantalla para que el dock no tape nada. */
export function useDockSpace(): number {
  const insets = useSafeAreaInsets();
  return DOCK_HEIGHT + Math.max(insets.bottom, 12) + 16;
}
