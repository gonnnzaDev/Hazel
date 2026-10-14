import { Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { useUser } from '@/store/people';
import { useUi } from '@/store/ui';
import { colors, radii, spring } from '@/theme';

import { Glass } from './ui/Glass';
import { Icon } from './ui/Icon';
import { Touchable } from './ui/Touchable';
import { UserAvatar } from './UserAvatar';
import { Waveform } from './Waveform';

interface VoiceTileProps {
  userId: string;
  speaking: boolean;
  muted?: boolean;
  deafened?: boolean;
  /** Ping de esa persona al servidor, en ms. */
  latency: number | null;
  index: number;
}

/**
 * Una persona en la sala de voz: avatar con anillo verde cuando habla, su onda
 * y su latencia. El borde se enciende mientras habla.
 */
export function VoiceTile({ userId, speaking, muted, deafened, latency, index }: VoiceTileProps) {
  const user = useUser(userId);
  const openSheet = useUi((s) => s.openSheet);
  const ping = latency === null ? null : Math.round(latency);
  const pingColor = ping === null ? colors.textDim : ping < 60 ? colors.lime : ping < 120 ? colors.warning : colors.danger;

  return (
    <Animated.View
      entering={ZoomIn.delay(index * 70).springify().damping(spring.damping).stiffness(spring.stiffness)}
      style={{ flexBasis: '48%', flexGrow: 1 }}
    >
      <Touchable onPress={() => openSheet({ kind: 'profile', userId })} scaleTo={0.97}>
        <Glass radius={radii.lg} glowColor={speaking ? colors.lime : undefined}>
          <View className="items-center gap-2 px-3 pb-3 pt-4">
            <UserAvatar user={user} size={62} speaking={speaking} />
            <Text className="font-sans-semibold text-[14px] text-ink" numberOfLines={1}>
              {user?.displayName ?? userId}
            </Text>
            <Waveform active={speaking} color={speaking ? colors.lime : colors.textDim} />
            <View className="w-full flex-row items-center justify-between">
              <View className="flex-row items-center gap-1">
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pingColor }} />
                <Text className="font-mono text-[10px] text-muted">{ping === null ? '—' : `${ping}ms`}</Text>
              </View>
              <View className="flex-row gap-1.5">
                {muted ? <Icon name="mic-off" size={13} color={colors.danger} /> : null}
                {deafened ? <Icon name="volume-x" size={13} color={colors.danger} /> : null}
                {!muted && !deafened ? <Icon name="mic" size={13} color={speaking ? colors.lime : colors.textDim} /> : null}
              </View>
            </View>
          </View>
        </Glass>
      </Touchable>
    </Animated.View>
  );
}
