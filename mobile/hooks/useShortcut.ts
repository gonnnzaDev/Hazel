import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Atajo de teclado (web, o un teclado físico en tablet): `mod+k` abre la
 * paleta, como en Wofi con un bind de Hyprland. `mod` es Ctrl o Cmd.
 */
export function useShortcut(key: string, handler: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        handler();
      }
    };
    // En captura: el TextInput de react-native-web frena la propagación.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [key, handler]);
}
