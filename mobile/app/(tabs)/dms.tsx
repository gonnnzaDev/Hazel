import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import type { Activity, User } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { Glass } from '@/components/ui/Glass';
import { Icon } from '@/components/ui/Icon';
import { NeonButton } from '@/components/ui/NeonButton';
import { Touchable } from '@/components/ui/Touchable';
import { UserAvatar } from '@/components/UserAvatar';
import { useDockSpace } from '@/hooks/useDockSpace';
import { relative } from '@/lib/format';
import { plainText } from '@/lib/markdown';
import { ME_ID } from '@/mocks/users';
import { useMessages } from '@/store/messages';
import { displayName, getUser, usePeople } from '@/store/people';
import { useSocial } from '@/store/social';
import { useUi } from '@/store/ui';
import { colors, radii, spring } from '@/theme';

type Tab = 'dms' | 'amigos';
type Filter = 'online' | 'todos' | 'pendientes';

const ACTIVITY_VERB: Record<Activity['kind'], string> = {
  playing: 'Jugando a',
  listening: 'Escuchando',
  coding: 'Programando en',
  watching: 'Mirando',
};

function statusLine(user: User): string {
  if (user.activity) return `${ACTIVITY_VERB[user.activity.kind]} ${user.activity.name}`;
  if (user.customStatus) return user.customStatus;
  return { online: 'En línea', idle: 'Ausente', dnd: 'No molestar', offline: 'Desconectado' }[user.presence];
}

function matchesQuery(user: User | undefined, q: string): boolean {
  if (!user) return false;
  return !q || user.displayName.toLowerCase().includes(q) || user.username.includes(q);
}

/** Mensajes directos y amigos: en línea, todos, solicitudes y búsqueda. */
export default function DirectMessages() {
  const dockSpace = useDockSpace();
  const [tab, setTab] = useState<Tab>('dms');
  const [filter, setFilter] = useState<Filter>('online');
  const [query, setQuery] = useState('');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const { friends, requests, dms, unread } = useSocial();
  const byChannel = useMessages((s) => s.byChannel);
  usePeople((s) => s.presence); // re-render con los cambios de presencia
  const toast = useUi((s) => s.toast);

  const q = query.trim().toLowerCase();

  const conversations = useMemo(
    () =>
      dms
        .map((dm) => {
          const messages = byChannel[dm.id] ?? [];
          return { dm, user: getUser(dm.userId), last: messages[messages.length - 1] };
        })
        .filter((c) => matchesQuery(c.user, q))
        .sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0)),
    [dms, byChannel, q],
  );

  const friendUsers = friends.map(getUser).filter((u): u is User => matchesQuery(u, q));
  const visibleFriends = filter === 'online' ? friendUsers.filter((u) => u.presence !== 'offline') : friendUsers;

  const openDm = (userId: string) => router.push(`/dm/${useSocial.getState().openDm(userId)}`);

  const addFriend = () => {
    try {
      useSocial.getState().sendRequest(addName);
      toast(`Solicitud enviada a @${addName.replace(/^@/, '')}`, 'success');
      setAddName('');
      setAddError(null);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'No se pudo enviar');
    }
  };

  return (
    <View className="flex-1 px-3 pt-1">
      <View className="flex-row items-center justify-between px-1 pb-3">
        <Text className="font-mono-bold text-xl text-ink">
          <Text className="text-purple">~/</Text>
          {tab === 'dms' ? 'mensajes' : 'amigos'}
        </Text>
        <View className="flex-row rounded-2xl border border-line p-1">
          {(['dms', 'amigos'] as const).map((t) => (
            <Touchable key={t} haptic="select" onPress={() => setTab(t)}>
              <View
                className="rounded-xl px-3 py-1.5"
                style={tab === t ? { backgroundColor: 'rgba(168,85,247,0.16)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.5)' } : undefined}
              >
                <Text className="font-mono text-[12px]" style={{ color: tab === t ? colors.purple : colors.textMuted }}>
                  {t}
                  {t === 'amigos' && requests.some((r) => r.direction === 'incoming') ? ' •' : ''}
                </Text>
              </View>
            </Touchable>
          ))}
        </View>
      </View>

      <Field icon="search" placeholder={tab === 'dms' ? 'Buscar conversación' : 'Buscar amigos'} value={query} onChangeText={setQuery} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: dockSpace + 56, paddingTop: 8 }}>
        {tab === 'dms' ? (
          conversations.length ? (
            conversations.map(({ dm, user, last }, i) => (
              <Animated.View key={dm.id} entering={FadeInDown.delay(i * 40).springify().damping(spring.damping).stiffness(spring.stiffness)}>
                <Touchable onPress={() => openDm(dm.userId)} scaleTo={0.98}>
                  <View className="flex-row items-center gap-3 rounded-2xl px-2 py-2.5">
                    <UserAvatar user={user} size={46} showPresence />
                    <View className="flex-1 gap-0.5">
                      <View className="flex-row items-center justify-between">
                        <Text className={unread[dm.id] ? 'font-sans-bold text-[15px] text-ink' : 'font-sans-semibold text-[15px] text-ink'}>
                          {user?.displayName}
                        </Text>
                        {last ? <Text className="font-mono text-[10px] text-dim">{relative(last.createdAt)}</Text> : null}
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Text className="flex-1 font-sans text-[13px] text-muted" numberOfLines={1}>
                          {last ? `${last.authorId === ME_ID ? 'Vos: ' : ''}${plainText(last.content, displayName)}` : 'Decí hola 👋'}
                        </Text>
                        <Badge count={unread[dm.id] ?? 0} tone="mention" />
                      </View>
                    </View>
                  </View>
                </Touchable>
              </Animated.View>
            ))
          ) : (
            <EmptyState icon="message-circle" title="Sin conversaciones" text="Abrí un DM desde la lista de amigos o el perfil de alguien." />
          )
        ) : (
          <View>
            <View className="flex-row gap-2 py-1">
              {(['online', 'todos', 'pendientes'] as const).map((f) => {
                const count = f === 'pendientes' ? requests.length : f === 'online' ? friendUsers.filter((u) => u.presence !== 'offline').length : friendUsers.length;
                return (
                  <Touchable key={f} haptic="select" onPress={() => setFilter(f)}>
                    <View
                      className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
                      style={{
                        borderWidth: 1,
                        borderColor: filter === f ? 'rgba(0,229,255,0.5)' : colors.border,
                        backgroundColor: filter === f ? 'rgba(0,229,255,0.1)' : 'transparent',
                      }}
                    >
                      <Text className="font-mono text-[11px]" style={{ color: filter === f ? colors.cyan : colors.textMuted }}>
                        {f === 'online' ? 'en línea' : f}
                      </Text>
                      <Text className="font-mono text-[10px] text-dim">{count}</Text>
                    </View>
                  </Touchable>
                );
              })}
            </View>

            {filter === 'pendientes' ? (
              <View>
                <Glass radius={radii.md} style={{ marginTop: 8 }}>
                  <View className="gap-3 p-3">
                    <Text className="font-mono text-[11px] uppercase tracking-widest text-dim">agregar amigo</Text>
                    <Field icon="user-plus" placeholder="@usuario (probá @juanpi)" value={addName} onChangeText={setAddName} error={addError} onSubmitEditing={addFriend} />
                    <NeonButton label="Enviar solicitud" icon="send" tone="purple" compact onPress={addFriend} disabled={!addName.trim()} />
                  </View>
                </Glass>
                <SectionLabel right={String(requests.length)}>solicitudes</SectionLabel>
                {requests.length ? (
                  requests.map((request) => {
                    const user = getUser(request.userId);
                    return (
                      <Animated.View key={request.id} layout={LinearTransition.springify().damping(spring.damping)}>
                        <View className="flex-row items-center gap-3 px-2 py-2">
                          <UserAvatar user={user} size={40} showPresence />
                          <View className="flex-1">
                            <Text className="font-sans-semibold text-[15px] text-ink">{user?.displayName}</Text>
                            <Text className="font-mono text-[11px] text-dim">
                              {request.direction === 'incoming' ? 'te quiere agregar' : 'solicitud enviada'}
                            </Text>
                          </View>
                          {request.direction === 'incoming' ? (
                            <Touchable onPress={() => useSocial.getState().acceptRequest(request.id)} accessibilityLabel="Aceptar">
                              <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(191,255,0,0.14)' }}>
                                <Icon name="check" size={17} color={colors.lime} />
                              </View>
                            </Touchable>
                          ) : null}
                          <Touchable onPress={() => useSocial.getState().declineRequest(request.id)} accessibilityLabel="Rechazar">
                            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(255,77,109,0.12)' }}>
                              <Icon name="x" size={17} color={colors.danger} />
                            </View>
                          </Touchable>
                        </View>
                      </Animated.View>
                    );
                  })
                ) : (
                  <EmptyState icon="inbox" title="Nada pendiente" />
                )}
              </View>
            ) : visibleFriends.length ? (
              <>
                <SectionLabel right={String(visibleFriends.length)}>{filter === 'online' ? 'en línea' : 'todos'}</SectionLabel>
                {visibleFriends.map((user) => (
                  <Touchable key={user.id} onPress={() => useUi.getState().openSheet({ kind: 'profile', userId: user.id })} scaleTo={0.98}>
                    <View className="flex-row items-center gap-3 rounded-2xl px-2 py-2">
                      <UserAvatar user={user} size={40} showPresence />
                      <View className="flex-1">
                        <Text className="font-sans-semibold text-[15px] text-ink">{user.displayName}</Text>
                        <Text
                          className="font-sans text-[12px]"
                          style={{ color: user.activity ? colors.lime : colors.textDim }}
                          numberOfLines={1}
                        >
                          {statusLine(user)}
                        </Text>
                      </View>
                      <Touchable onPress={() => openDm(user.id)} accessibilityLabel={`Mensaje a ${user.displayName}`}>
                        <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                          <Icon name="message-circle" size={16} color={colors.cyan} />
                        </View>
                      </Touchable>
                    </View>
                  </Touchable>
                ))}
              </>
            ) : (
              <EmptyState icon="users" title="Nadie por acá" text={q ? 'Probá con otra búsqueda.' : 'Cuando tus amigos se conecten, aparecen acá.'} />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
