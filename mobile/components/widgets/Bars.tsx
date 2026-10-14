import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { colors } from '@/theme';

interface BarsProps {
  values: number[];
  /** Tope de la escala. Fijo, para que la altura signifique siempre lo mismo. */
  max: number;
  color: string;
  height?: number;
  /** Se llama al tocar una barra con su índice (o `null` al soltar). */
  onInspect?: (index: number | null) => void;
}

/**
 * Mini gráfico de barras: una sola serie, barras finas apoyadas en la base con
 * 2px entre sí y la punta redondeada. Tocar una barra la resalta para leer su
 * valor (en móvil no hay hover).
 */
export function Bars({ values, max, color, height = 44, onInspect }: BarsProps) {
  const [active, setActive] = useState<number | null>(null);

  const inspect = (index: number | null) => {
    setActive(index);
    onInspect?.(index);
  };

  return (
    <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {values.map((value, i) => {
        const h = Math.max(2, Math.min(1, value / max) * height);
        const highlighted = active === null ? i === values.length - 1 : active === i;
        return (
          <Pressable
            key={i}
            onPressIn={() => inspect(i)}
            onPressOut={() => inspect(null)}
            style={{ flex: 1, height, justifyContent: 'flex-end' }}
            accessibilityLabel={`Muestra ${i + 1}: ${Math.round(value)}`}
          >
            <View
              style={{
                height: h,
                borderTopLeftRadius: 2,
                borderTopRightRadius: 2,
                backgroundColor: color,
                opacity: highlighted ? 1 : 0.38,
              }}
            />
          </Pressable>
        );
      })}
      {/* Línea de base, recesiva. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}
