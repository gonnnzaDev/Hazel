import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View, type TextInput } from 'react-native';

import { AuthShell } from '@/components/AuthShell';
import { Field } from '@/components/ui/Field';
import { NeonButton } from '@/components/ui/NeonButton';
import { useHaptics } from '@/hooks/useHaptics';
import { useAuth } from '@/store/auth';

export default function Login() {
  const login = useAuth((s) => s.login);
  const haptics = useHaptics();
  const passwordRef = useRef<TextInput>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      haptics.success();
      router.replace('/(tabs)');
    } catch (e) {
      haptics.warn();
      setError(e instanceof Error ? e.message : 'No se pudo entrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="recop login" subtitle="Tu chat. Tu máquina. Tu puerto.">
      <Field
        label="usuario"
        icon="at-sign"
        placeholder="ana"
        value={username}
        onChangeText={setUsername}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        autoComplete="username"
      />
      <Field
        ref={passwordRef}
        label="contraseña"
        icon="lock"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        autoComplete="password"
        error={error}
      />
      <NeonButton label="Entrar" icon="log-in" solid loading={loading} onPress={() => void submit()} />
      <View className="flex-row justify-center gap-1">
        <Text className="font-sans text-sm text-muted">¿Primera vez?</Text>
        <Link href="/register" replace>
          <Text className="font-sans-semibold text-sm text-cyan">Crear cuenta</Text>
        </Link>
      </View>
      <Text className="text-center font-mono text-[10px] text-dim">modo demo · cualquier usuario y una contraseña de 4+ caracteres</Text>
    </AuthShell>
  );
}
