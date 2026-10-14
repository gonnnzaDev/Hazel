import type { Config } from 'tailwindcss';

import { colors, fonts, radii } from './theme';

// Las clases de Tailwind salen del mismo tema que usa el código (theme.ts):
// `bg-base`, `text-cyan`, `border-line`, `rounded-panel`, `font-mono`…
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        base: colors.base,
        raised: colors.baseRaised,
        glass: colors.glass,
        line: colors.border,
        'line-strong': colors.borderStrong,
        ink: colors.text,
        muted: colors.textMuted,
        dim: colors.textDim,
        cyan: colors.cyan,
        purple: colors.purple,
        lime: colors.lime,
        danger: colors.danger,
        warning: colors.warning,
      },
      borderRadius: {
        chip: `${radii.sm}px`,
        card: `${radii.md}px`,
        panel: `${radii.lg}px`,
      },
      fontFamily: {
        mono: [fonts.mono],
        'mono-regular': [fonts.monoRegular],
        'mono-bold': [fonts.monoBold],
        sans: [fonts.sans],
        'sans-medium': [fonts.sansMedium],
        'sans-semibold': [fonts.sansSemibold],
        'sans-bold': [fonts.sansBold],
      },
    },
  },
  plugins: [],
} satisfies Config;
