import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthShell } from '@/components/AuthShell';
import { Field } from '@/components/ui/Field';
import { NeonButton } from '@/components/ui/NeonButton';
import { useHaptics } from '@/hooks/useHaptics';
import { normalizeUsername, useAuth } from '@/store/auth';

export default function Register() {
  const register = useAuth((s) => s.register);
  const haptics = useHaptics();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const normalized = normalizeUsername(username);
  const preview = username && normalized !== username ? `Vas a ser @${normalized || '…'}` : '2 a 32: letras, números, punto, guion y guion bajo.';

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await register({ username, displayName, password });
      haptics.success();
      router.replace('/onboarding');
    } catch (e) {
      haptics.warn();
      setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="nueva sesión" subtitle="Elegí tu nombre. Nadie más guarda tus datos.">
      <Field label="usuario" icon="at-sign" placeholder="ana_paula" value={username} onChangeText={setUsername} hint={preview} />
      <Field label="nombre visible" icon="user" placeholder="Ana Paula" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <Field
        label="contraseña"
        icon="lock"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        onSubmitEditing={() => void submit()}
        error={error}
      />
      <NeonButton label="Crear cuenta" icon="user-plus" tone="purple" solid loading={loading} onPress={() => void submit()} />
      <View className="flex-row justify-center gap-1">
        <Text className="font-sans text-sm text-muted">¿Ya tenés sesión?</Text>
        <Link href="/login" replace>
          <Text className="font-sans-semibold text-sm text-cyan">Entrar</Text>
        </Link>
      </View>
    </AuthShell>
  );
}
