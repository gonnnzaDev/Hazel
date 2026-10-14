import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { User } from '@/api/types';
import { useHaptics } from '@/hooks/useHaptics';
import { useShortcut } from '@/hooks/useShortcut';
import { fuzzyFilter } from '@/lib/fuzzy';
import { users } from '@/mocks/users';
import { useAuth } from '@/store/auth';
import { useServers } from '@/store/servers';
import { useSocial } from '@/store/social';
import { useUi } from '@/store/ui';
import { useVoice } from '@/store/voice';
import { colors, fonts, glow, radii, spring } from '@/theme';

import { Glass } from './ui/Glass';
import { Icon, type IconName } from './ui/Icon';
import { Touchable } from './ui/Touchable';
import { UserAvatar } from './UserAvatar';

type Section = 'Acciones' | 'Servidores' | 'Canales' | 'Personas';

interface WofiItem {
  id: string;
  section: Section;
  icon: IconName;
  title: string;
  subtitle?: string;
  user?: User;
  accent?: string;
  run: () => void;
}

const SECTIONS: Section[] = ['Acciones', 'Servidores', 'Canales', 'Personas'];

/** Abre y cierra la paleta con mod+k (web o teclado físico). */
export function useWofiShortcut() {
  const toggle = () => {
    const ui = useUi.getState();
    if (ui.wofiOpen) ui.closeWofi();
    else ui.openWofi();
  };
  useShortcut('k', toggle);
}

/**
 * Paleta de comandos estilo Wofi/Rofi: una búsqueda difusa sobre acciones,
 * servidores, canales y personas. Se abre con el botón flotante, manteniendo
 * apretado "home" en el dock, o con Ctrl/Cmd+K.
 */
export function WofiSearch() {
  const open = useUi((s) => s.wofiOpen);
  if (!open) return null;
  return <WofiPanel />;
}

function WofiPanel() {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const { closeWofi, openSheet, toast } = useUi.getState();
  const servers = useServers((s) => s.servers);
  const connected = useVoice((s) => s.connectedChannelId);
  const muted = useVoice((s) => s.muted);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeWofi();
      return true;
    });
    return () => sub.remove();
  }, [closeWofi]);

  // En web, la animación de entrada deja el panel oculto durante el primer
  // frame y `autoFocus` no llega a enfocar: se enfoca un instante después.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  // Esc cierra la paleta esté donde esté el foco. Va en captura porque el
  // TextInput de react-native-web frena la propagación de las teclas.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWofi();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeWofi]);

  const items = useMemo<WofiItem[]>(() => {
    const voice = useVoice.getState();
    const actions: WofiItem[] = [
      { id: 'a-server', section: 'Acciones', icon: 'plus-square', title: 'Crear o unirse a un servidor', run: () => openSheet({ kind: 'server-actions' }) },
      { id: 'a-status', section: 'Acciones', icon: 'smile', title: 'Cambiar estado', subtitle: 'presencia y estado personalizado', run: () => openSheet({ kind: 'status' }) },
      { id: 'a-mentions', section: 'Acciones', icon: 'at-sign', title: 'Ver menciones', run: () => router.push('/mentions') },
      { id: 'a-dms', section: 'Acciones', icon: 'message-circle', title: 'Mensajes directos', run: () => router.navigate('/dms') },
      { id: 'a-settings', section: 'Acciones', icon: 'sliders', title: 'Ajustes', run: () => openSheet({ kind: 'settings' }) },
    ];
    if (connected) {
      actions.unshift(
        { id: 'a-mute', section: 'Acciones', icon: muted ? 'mic' : 'mic-off', title: muted ? 'Activar micrófono' : 'Silenciar micrófono', run: () => voice.toggleMute() },
        { id: 'a-leave', section: 'Acciones', icon: 'phone-off', title: 'Desconectar de voz', accent: colors.danger, run: () => voice.leave() },
      );
    }
    actions.push({
      id: 'a-logout',
      section: 'Acciones',
      icon: 'log-out',
      title: 'Cerrar sesión',
      accent: colors.danger,
      run: () => {
        voice.leave();
        useAuth.getState().logout();
        router.replace('/login');
      },
    });

    const serverItems: WofiItem[] = servers.map((server) => ({
      id: `s-${server.id}`,
      section: 'Servidores',
      icon: 'server',
      title: server.name,
      subtitle: server.description,
      accent: server.accent,
      run: () => {
        useServers.getState().selectServer(server.id);
        router.navigate('/');
      },
    }));

    const channelItems: WofiItem[] = servers.flatMap((server) =>
      server.channels.map((channel) => ({
        id: `c-${channel.id}`,
        section: 'Canales' as const,
        icon: (channel.type === 'voice' ? 'volume-2' : channel.type === 'announcement' ? 'radio' : 'hash') as IconName,
        title: channel.name,
        subtitle: server.name,
        run: () => {
          useServers.getState().selectServer(server.id);
          if (channel.type === 'voice') {
            void voice.join(channel.id);
            router.navigate('/voice');
          } else {
            router.push(`/channel/${channel.id}`);
          }
        },
      })),
    );

    const peopleItems: WofiItem[] = users.map((user) => ({
      id: `u-${user.id}`,
      section: 'Personas',
      icon: 'user',
      title: user.displayName,
      subtitle: `@${user.username}${user.customStatus ? ` · ${user.customStatus}` : ''}`,
      user,
      run: () => {
        if (useSocial.getState().friends.includes(user.id)) {
          router.push(`/dm/${useSocial.getState().openDm(user.id)}`);
        } else {
          openSheet({ kind: 'profile', userId: user.id });
        }
      },
    }));

    return [...actions, ...serverItems, ...channelItems, ...peopleItems];
  }, [servers, connected, muted, openSheet]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // Sin búsqueda: un poco de cada sección.
      return SECTIONS.flatMap((section) => items.filter((i) => i.section === section).slice(0, section === 'Acciones' ? 6 : 4));
    }
    return fuzzyFilter(items, query, (i) => `${i.title} ${i.subtitle ?? ''}`, 24);
  }, [items, query]);

  const run = (item: WofiItem | undefined) => {
    if (!item) {
      toast('Nada que coincida', 'error');
      return;
    }
    haptics.success();
    closeWofi();
    item.run();
  };

  // Agrupa respetando el orden de puntaje dentro de cada sección.
  const grouped = SECTIONS.map((section) => ({ section, items: results.filter((r) => r.section === section) })).filter(
    (g) => g.items.length,
  );
  const first = results[0];

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={StyleSheet.absoluteFill}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,5,8,0.7)' }]} onPress={closeWofi} />
      </Animated.View>

      <Animated.View
        entering={ZoomIn.springify().damping(spring.damping).stiffness(spring.stiffness)}
        style={{ marginTop: insets.top + 64, marginHorizontal: 12 }}
      >
        <Glass strong intensity={90} radius={radii.lg} glowColor={colors.purple}>
          <View className="flex-row items-center gap-2 border-b border-line px-4" style={{ height: 52 }}>
            <Text className="font-mono-bold text-base text-cyan">❯</Text>
            <TextInput
              ref={inputRef}
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="drun: servidores, canales, gente, acciones…"
              placeholderTextColor={colors.textDim}
              selectionColor={colors.cyan}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => run(first)}
              style={{ flex: 1, color: colors.text, fontFamily: fonts.mono, fontSize: 14, height: '100%', outlineWidth: 0 }}
            />
            <Touchable onPress={closeWofi} haptic="none" accessibilityLabel="Cerrar">
              <View className="rounded-md border border-line px-1.5 py-0.5">
                <Text className="font-mono text-[10px] text-dim">esc</Text>
              </View>
            </Touchable>
          </View>

          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 8 }}>
            {grouped.length === 0 ? (
              <Text className="p-6 text-center font-mono text-sm text-dim">sin coincidencias para “{query}”</Text>
            ) : null}
            {grouped.map((group) => (
              <View key={group.section} className="mb-1">
                <Text className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-widest text-dim">{group.section}</Text>
                {group.items.map((item) => {
                  const isFirst = item === first;
                  return (
                    <Touchable key={item.id} onPress={() => run(item)} haptic="none" scaleTo={0.98}>
                      <View
                        className="flex-row items-center gap-3 rounded-xl px-2 py-2"
                        style={
                          isFirst
                            ? [{ backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)' }, glow(colors.cyan, 8, 0.25)]
                            : { borderWidth: 1, borderColor: 'transparent' }
                        }
                      >
                        {item.user ? (
                          <UserAvatar user={item.user} size={30} showPresence ringBackground={colors.baseRaised} />
                        ) : (
                          <View
                            className="h-[30px] w-[30px] items-center justify-center rounded-lg"
                            style={{ backgroundColor: `${item.accent ?? colors.cyan}1f` }}
                          >
                            <Icon name={item.icon} size={15} color={item.accent ?? colors.cyan} />
                          </View>
                        )}
                        <View className="flex-1">
                          <Text className="font-mono text-[13px] text-ink" numberOfLines={1}>
                            {item.section === 'Canales' && item.icon === 'hash' ? `#${item.title}` : item.title}
                          </Text>
                          {item.subtitle ? (
                            <Text className="font-sans text-[11px] text-dim" numberOfLines={1}>
                              {item.subtitle}
                            </Text>
                          ) : null}
                        </View>
                        {isFirst ? <Text className="font-mono text-[11px] text-cyan">↵</Text> : null}
                      </View>
                    </Touchable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Glass>
      </Animated.View>
    </View>
  );
}

/** Botón flotante para abrir la paleta, arriba del dock. */
export function WofiFab({ bottom }: { bottom: number }) {
  const openWofi = useUi((s) => s.openWofi);
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: 16, bottom }}>
      <Touchable onPress={openWofi} accessibilityLabel="Buscar" scaleTo={0.9}>
        <Glass radius={radii.pill} glowColor={colors.purple} strong>
          <View className="h-12 w-12 items-center justify-center">
            <Icon name="command" size={19} color={colors.purple} />
          </View>
        </Glass>
      </Touchable>
    </View>
  );
}
