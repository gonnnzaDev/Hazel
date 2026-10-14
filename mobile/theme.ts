/**
 * Tema central de la app. Todo color, radio, espacio, fuente y animación sale
 * de acá: Tailwind (tailwind.config.ts) lee estos mismos valores, así que una
 * clase como `bg-base` y `theme.colors.base` son siempre el mismo color.
 *
 * Estética: tiling WM tipo Hyprland. Fondo casi negro, paneles de vidrio con
 * blur, bordes de 1px casi invisibles y tres acentos neón con un brillo suave
 * en lo que está activo.
 */

export const colors = {
  base: '#0a0e14',
  baseRaised: '#0e131b',
  /** Fondo de los paneles de vidrio, encima del blur. */
  glass: 'rgba(14, 20, 30, 0.55)',
  glassStrong: 'rgba(16, 22, 33, 0.82)',
  glassHover: 'rgba(255, 255, 255, 0.05)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',

  text: '#E6EDF3',
  textMuted: '#8B98A9',
  textDim: '#566273',

  cyan: '#00E5FF',
  purple: '#A855F7',
  lime: '#BFFF00',
  danger: '#FF4D6D',
  warning: '#FFB020',
} as const;

/** Color de la presencia de alguien. */
export const presenceColors = {
  online: colors.lime,
  idle: colors.warning,
  dnd: colors.danger,
  offline: colors.textDim,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

/** Separación entre paneles, como el `gaps_in`/`gaps_out` de Hyprland. */
export const gaps = {
  inner: 8,
  outer: 12,
} as const;

/**
 * Familias cargadas en app/_layout.tsx. En React Native `fontWeight` no elige
 * otro archivo de una fuente custom: cada peso es una familia aparte.
 */
export const fonts = {
  mono: 'JetBrainsMono_500Medium',
  monoRegular: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
} as const;

/** El resorte de todas las animaciones: suave, sin rebote exagerado. */
export const spring = {
  damping: 20,
  stiffness: 200,
  mass: 1,
} as const;

/** Intensidad del blur de los paneles (BlurView). */
export const blur = {
  panel: 70,
  overlay: 90,
} as const;

/** Sombra neón para lo activo. En Android `elevation` no admite color: se usa el borde. */
export function glow(color: string, radius = 14, opacity = 0.55) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 0 },
  };
}

export const theme = { colors, presenceColors, radii, gaps, fonts, spring, blur, glow } as const;

export default theme;
