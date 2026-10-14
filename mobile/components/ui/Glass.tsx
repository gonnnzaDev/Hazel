import { BlurView } from 'expo-blur';
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type View as ViewType, type ViewStyle } from 'react-native';

import { blur, colors, glow, radii } from '@/theme';

/**
 * En Android el blur nativo necesita saber qué vista difuminar. El fondo de la
 * app (components/Background.tsx) se registra acá y todos los paneles de
 * vidrio lo usan como objetivo. En iOS y web no hace falta.
 */
export const BlurTargetContext = createContext<RefObject<ViewType | null> | null>(null);

interface GlassProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Clases de NativeWind para el contenido (padding, gap, layout). */
  className?: string;
  radius?: number;
  intensity?: number;
  /** Más opaco: para lo que va encima de otros paneles (sheets, menús). */
  strong?: boolean;
  /** Borde y brillo neón, para lo que está activo. */
  glowColor?: string;
}

/**
 * Panel de vidrio: blur + tinte oscuro + borde de 1px casi invisible. Es la
 * pieza base de toda la interfaz, como una ventana de Hyprland.
 */
export function Glass({
  children,
  style,
  className,
  radius = radii.lg,
  intensity = blur.panel,
  strong = false,
  glowColor,
}: GlassProps) {
  const target = useContext(BlurTargetContext);

  return (
    // El brillo va en una vista de afuera: con `overflow: hidden` iOS recorta la sombra.
    <View style={[{ borderRadius: radius }, glowColor ? glow(glowColor) : null, style]}>
      <View
        className={className}
        style={{
          flexGrow: 1,
          borderRadius: radius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: glowColor ? `${glowColor}66` : colors.border,
        }}
      >
        <BlurView
          intensity={intensity}
          tint="dark"
          blurTarget={target ?? undefined}
          blurMethod={Platform.OS === 'android' && target ? 'dimezisBlurViewSdk31Plus' : undefined}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: strong ? colors.glassStrong : colors.glass }]}
        />
        {children}
      </View>
    </View>
  );
}
