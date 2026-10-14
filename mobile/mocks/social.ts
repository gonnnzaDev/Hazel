import type { DirectChannel, FriendRequest } from '@/api/types';

/** Amigos de la persona que usa la app. */
export const friendIds = ['u-ana', 'u-luis', 'u-nico', 'u-sofi', 'u-vale', 'u-marta', 'u-tomi'];

export const friendRequests: FriendRequest[] = [
  { id: 'fr-1', userId: 'u-juan', direction: 'incoming' },
  { id: 'fr-2', userId: 'u-caro', direction: 'outgoing' },
];

export const directChannels: DirectChannel[] = [
  { id: 'dm-u-ana', userId: 'u-ana' },
  { id: 'dm-u-luis', userId: 'u-luis' },
  { id: 'dm-u-nico', userId: 'u-nico' },
];
