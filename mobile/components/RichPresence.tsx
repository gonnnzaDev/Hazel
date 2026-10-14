import { Text, View } from 'react-native';

import type { Activity } from '@/api/types';
import { useNow } from '@/hooks/useNow';
import { duration } from '@/lib/format';
import { colors, radii } from '@/theme';

import { Icon, type IconName } from './ui/Icon';

const KINDS: Record<Activity['kind'], { label: string; icon: IconName; color: string }> = {
  playing: { label: 'jugando a', icon: 'play', color: colors.lime },
  listening: { label: 'escuchando', icon: 'music', color: colors.purple },
  coding: { label: 'programando en', icon: 'terminal', color: colors.cyan },
  watching: { label: 'mirando', icon: 'tv', color: colors.warning },
};

/** Tarjeta de "Rich Presence": qué hace alguien y hace cuánto. */
export function RichPresence({ activity }: { activity: Activity }) {
  const now = useNow(1000);
  const kind = KINDS[activity.kind];
  return (
    <View
      className="flex-row items-center gap-3 p-3"
      style={{ borderRadius: radii.md, borderWidth: 1, borderColor: `${kind.color}44`, backgroundColor: `${kind.color}0f` }}
    >
      <View className="h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: `${kind.color}22` }}>
        <Icon name={kind.icon} size={22} color={kind.color} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-mono text-[10px] uppercase tracking-widest" style={{ color: kind.color }}>
          {kind.label}
        </Text>
        <Text className="font-sans-semibold text-[15px] text-ink" numberOfLines={1}>
          {activity.name}
        </Text>
        {activity.details ? (
          <Text className="font-sans text-xs text-muted" numberOfLines={1}>
            {activity.details}
          </Text>
        ) : null}
      </View>
      <Text className="font-mono text-[11px] text-dim">{duration(activity.startedAt, now)}</Text>
    </View>
  );
}
