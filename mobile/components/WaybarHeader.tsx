import { router, usePathname } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBattery } from '@/hooks/useBattery';
import { useNow } from '@/hooks/useNow';
import { clock } from '@/lib/format';
import { mentionsOfMe, useMessages } from '@/store/messages';
import { useNet } from '@/store/net';
import { colors, radii } from '@/theme';

import { Glass } from './ui/Glass';
import { Icon, type IconName } from './ui/Icon';
import { Touchable } from './ui/Touchable';

/** Los "workspaces" son las pestañas, como los números de Hyprland en Waybar. */
const WORKSPACES = [
  { n: 1, path: '/', match: (p: string) => p === '/' },
  { n: 2, path: '/dms', match: (p: string) => p.startsWith('/dms') || p.startsWith('/dm/') },
  { n: 3, path: '/voice', match: (p: string) => p.startsWith('/voice') },
  { n: 4, path: '/profile', match: (p: string) => p.startsWith('/profile') || p.startsWith('/mentions') },
] as const;

function latencyTone(ms: number | null): { color: string; icon: IconName; label: string } {
  if (ms === null) return { color: colors.textDim, icon: 'activity', label: '— ms' };
  if (ms < 60) return { color: colors.lime, icon: 'activity', label: `${ms}ms` };
  if (ms < 120) return { color: colors.warning, icon: 'alert-triangle', label: `${ms}ms` };
  return { color: colors.danger, icon: 'alert-octagon', label: `${ms}ms` };
}

/**
 * Barra superior estilo Waybar: workspaces a la izquierda, reloj al centro y
 * a la derecha latencia, conexión, batería y menciones.
 */
export function WaybarHeader() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const now = useNow(1000);
  const { status, latency } = useNet();
  const battery = useBattery();
  const mentionCount = useMessages((s) => mentionsOfMe(s.byChannel).length);
  const tone = latencyTone(status === 'online' ? latency : null);

  const connection: { icon: IconName; color: string } =
    status === 'online'
      ? { icon: 'wifi', color: colors.cyan }
      : status === 'offline'
        ? { icon: 'wifi-off', color: colors.danger }
        : { icon: 'refresh-cw', color: colors.warning };

  return (
    <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 4 }}>
      <Glass radius={radii.md} intensity={80} style={{ height: 36 }}>
        <View className="h-full flex-row items-center justify-between px-2">
          {/* Workspaces */}
          <View className="flex-row items-center gap-1">
            {WORKSPACES.map((ws) => {
              const active = ws.match(pathname);
              return (
                <Touchable
                  key={ws.n}
                  haptic="select"
                  onPress={() => router.navigate(ws.path)}
                  accessibilityLabel={`Workspace ${ws.n}`}
                >
                  <View
                    style={{
                      width: active ? 26 : 20,
                      height: 20,
                      borderRadius: 6,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? colors.cyan : 'rgba(255,255,255,0.04)',
                      borderWidth: 1,
                      borderColor: active ? colors.cyan : colors.border,
                    }}
                  >
                    <Text className="font-mono-bold text-[10px]" style={{ color: active ? colors.base : colors.textMuted }}>
                      {ws.n}
                    </Text>
                  </View>
                </Touchable>
              );
            })}
          </View>

          {/* Reloj */}
          <Text className="font-mono-bold text-[13px] text-ink" style={{ letterSpacing: 1 }}>
            {clock(new Date(now), true)}
          </Text>

          {/* Estado */}
          <View className="flex-row items-center gap-2.5">
            <Touchable haptic="none" onPress={() => router.navigate('/profile')} accessibilityLabel="Latencia">
              <View className="flex-row items-center gap-1">
                <Icon name={tone.icon} size={12} color={tone.color} />
                <Text className="font-mono text-[11px] text-muted">{tone.label}</Text>
              </View>
            </Touchable>
            <Icon name={connection.icon} size={13} color={connection.color} />
            <View className="flex-row items-center gap-1">
              <Icon
                name={battery.charging ? 'battery-charging' : 'battery'}
                size={13}
                color={battery.level !== null && battery.level < 0.2 ? colors.danger : colors.textMuted}
              />
              <Text className="font-mono text-[11px] text-muted">
                {battery.level === null ? 'AC' : `${Math.round(battery.level * 100)}%`}
              </Text>
            </View>
            <Touchable onPress={() => router.navigate('/mentions')} accessibilityLabel="Menciones" hitSlop={6}>
              <View>
                <Icon name="bell" size={14} color={mentionCount ? colors.text : colors.textMuted} />
                {mentionCount ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -4,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: colors.danger,
                    }}
                  />
                ) : null}
              </View>
            </Touchable>
          </View>
        </View>
      </Glass>
    </View>
  );
}
