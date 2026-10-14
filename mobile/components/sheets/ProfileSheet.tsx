import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { ME_ID } from '@/mocks/users';
import { useUser } from '@/store/people';
import { topRole, useServers } from '@/store/servers';
import { useSocial } from '@/store/social';
import { useUi } from '@/store/ui';
import { colors } from '@/theme';

import { RichPresence } from '../RichPresence';
import { RoleBadge } from '../RoleBadge';
import { NeonButton } from '../ui/NeonButton';
import { Sheet } from '../ui/Sheet';
import { UserAvatar } from '../UserAvatar';

const PRESENCE_LABEL = { online: 'En línea', idle: 'Ausente', dnd: 'No molestar', offline: 'Desconectado' } as const;

/** El perfil de alguien: banner, avatar, estado, actividad, roles y acciones. */
export function ProfileSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const user = useUser(userId);
  const server = useServers((s) => s.servers.find((sv) => sv.id === s.activeServerId));
  const isFriend = useSocial((s) => s.friends.includes(userId));
  const pending = useSocial((s) => s.requests.some((r) => r.userId === userId));
  const { openSheet, toast } = useUi.getState();
  const isMe = userId === ME_ID;

  if (!user) return null;

  const member = server?.members.find((m) => m.userId === userId);
  const roles = server && member ? server.roles.filter((r) => member.roleIds.includes(r.id)).sort((a, b) => b.position - a.position) : [];
  const nameColor = topRole(server, userId)?.color ?? colors.text;

  return (
    <Sheet onClose={onClose}>
      <View className="px-4">
        <LinearGradient colors={user.banner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 86, borderRadius: 16 }} />
        <View className="-mt-10 ml-3">
          <View style={{ padding: 4, borderRadius: 48, backgroundColor: colors.baseRaised, alignSelf: 'flex-start' }}>
            <UserAvatar user={user} size={76} showPresence ringBackground={colors.baseRaised} />
          </View>
        </View>

        <View className="gap-1 pt-2">
          <Text className="font-mono-bold text-xl" style={{ color: nameColor === colors.textMuted ? colors.text : nameColor }}>
            {user.displayName}
          </Text>
          <Text className="font-mono text-xs text-muted">
            @{user.username} · {PRESENCE_LABEL[user.presence]}
          </Text>
          {user.customStatus ? <Text className="pt-1 font-sans text-sm text-ink">💬 {user.customStatus}</Text> : null}
        </View>

        {user.activity ? (
          <View className="pt-3">
            <RichPresence activity={user.activity} />
          </View>
        ) : null}

        {roles.length ? (
          <View className="gap-1.5 pt-3">
            <Text className="font-mono text-[10px] uppercase tracking-widest text-dim">roles en {server?.name}</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {roles.map((role) => (
                <RoleBadge key={role.id} role={role} />
              ))}
            </View>
          </View>
        ) : null}

        {user.bio ? (
          <View className="gap-1 pt-3">
            <Text className="font-mono text-[10px] uppercase tracking-widest text-dim">sobre mí</Text>
            <Text className="font-sans text-sm text-muted">{user.bio}</Text>
          </View>
        ) : null}

        <View className="flex-row gap-2 pt-4">
          {isMe ? (
            <View className="flex-1">
              <NeonButton label="Editar estado" icon="edit-3" onPress={() => openSheet({ kind: 'status' })} solid />
            </View>
          ) : (
            <>
              <View className="flex-1">
                <NeonButton
                  label="Mensaje"
                  icon="message-circle"
                  solid
                  onPress={() => {
                    onClose();
                    router.push(`/dm/${useSocial.getState().openDm(userId)}`);
                  }}
                />
              </View>
              <View className="flex-1">
                <NeonButton
                  label={isFriend ? 'Amigos' : pending ? 'Pendiente' : 'Agregar'}
                  icon={isFriend ? 'user-check' : 'user-plus'}
                  tone={isFriend ? 'lime' : 'purple'}
                  disabled={isFriend || pending}
                  onPress={() => {
                    try {
                      useSocial.getState().sendRequest(user.username);
                      toast(`Solicitud enviada a ${user.displayName}`, 'success');
                    } catch (error) {
                      toast(error instanceof Error ? error.message : 'No se pudo enviar', 'error');
                    }
                  }}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Sheet>
  );
}
