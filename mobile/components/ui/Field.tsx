import { forwardRef, useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, radii } from '@/theme';

import { Icon, type IconName } from './Icon';

interface FieldProps extends TextInputProps {
  label?: string;
  icon?: IconName;
  hint?: string;
  error?: string | null;
}

/** Campo de texto de vidrio: el borde se enciende en cyan con el foco. */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, icon, hint, error, onFocus, onBlur, style, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.cyan : colors.border;

  return (
    <View className="gap-1.5">
      {label ? <Text className="font-mono text-[11px] uppercase tracking-widest text-muted">{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 50,
          paddingHorizontal: 14,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor,
          backgroundColor: 'rgba(255,255,255,0.03)',
        }}
      >
        {icon ? <Icon name={icon} size={17} color={focused ? colors.cyan : colors.textDim} /> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textDim}
          selectionColor={colors.cyan}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          // outlineWidth: 0 saca el contorno del navegador en web; el foco ya se ve en el borde.
          style={[{ flex: 1, color: colors.text, fontFamily: fonts.sans, fontSize: 15, height: '100%', outlineWidth: 0 }, style]}
          {...input}
        />
      </View>
      {error ? (
        <Text className="font-sans text-xs text-danger">{error}</Text>
      ) : hint ? (
        <Text className="font-sans text-xs text-dim">{hint}</Text>
      ) : null}
    </View>
  );
});
