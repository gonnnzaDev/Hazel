import type { User } from '@/api/types';

const minutesAgo = (m: number) => Date.now() - m * 60_000;

/**
 * La gente de los servidores de prueba. La persona que usa la app no está
 * acá: la crea el login (store/auth.ts) con el id `ME_ID`.
 */
export const ME_ID = 'me';

export const users: User[] = [
  {
    id: 'u-luis',
    username: 'luis',
    displayName: 'Luis',
    avatarColor: '#7C3AED',
    banner: ['#A855F7', '#00E5FF'],
    presence: 'online',
    customStatus: 'hosteando desde el living',
    activity: { kind: 'coding', name: 'Neovim', details: 'recop/apps/servers', startedAt: minutesAgo(42) },
    bio: 'Dueño del nodo. Si se cae, es porque se cortó la luz.',
  },
  {
    id: 'u-ana',
    username: 'ana',
    displayName: 'Ana',
    avatarColor: '#0891B2',
    banner: ['#00E5FF', '#0a0e14'],
    presence: 'online',
    activity: { kind: 'playing', name: 'Hollow Knight', details: 'Ciudad de Lágrimas', startedAt: minutesAgo(18) },
    bio: 'Ricing de Hyprland a las 3 a. m.',
  },
  {
    id: 'u-marta',
    username: 'marta',
    displayName: 'Marta',
    avatarColor: '#65A30D',
    banner: ['#BFFF00', '#0a0e14'],
    presence: 'idle',
    customStatus: 'en el gym 🏋️',
  },
  {
    id: 'u-nico',
    username: 'nico',
    displayName: 'Nico',
    avatarColor: '#DB2777',
    banner: ['#FF4D6D', '#A855F7'],
    presence: 'dnd',
    customStatus: 'deploy en curso, no molestar',
    activity: { kind: 'listening', name: 'Synthwave Radio', details: 'Perturbator — Venger', startedAt: minutesAgo(7) },
  },
  {
    id: 'u-sofi',
    username: 'sofi',
    displayName: 'Sofía',
    avatarColor: '#EA580C',
    banner: ['#FFB020', '#FF4D6D'],
    presence: 'online',
    activity: { kind: 'watching', name: 'Twitch', details: 'speedrun de Celeste', startedAt: minutesAgo(25) },
  },
  {
    id: 'u-tomi',
    username: 'tomi',
    displayName: 'Tomi',
    avatarColor: '#2563EB',
    banner: ['#2563EB', '#00E5FF'],
    presence: 'offline',
  },
  {
    id: 'u-vale',
    username: 'vale',
    displayName: 'Vale',
    avatarColor: '#9333EA',
    banner: ['#A855F7', '#FF4D6D'],
    presence: 'online',
    customStatus: 'compilando el kernel otra vez',
  },
  {
    id: 'u-juan',
    username: 'juanpi',
    displayName: 'Juanpi',
    avatarColor: '#0D9488',
    banner: ['#0D9488', '#BFFF00'],
    presence: 'idle',
  },
  {
    id: 'u-caro',
    username: 'caro',
    displayName: 'Caro',
    avatarColor: '#BE123C',
    banner: ['#BE123C', '#FFB020'],
    presence: 'offline',
  },
  {
    id: 'u-bot',
    username: 'hyprbot',
    displayName: 'HyprBot',
    avatarColor: '#0a0e14',
    avatarEmoji: '🤖',
    banner: ['#00E5FF', '#BFFF00'],
    presence: 'online',
    bot: true,
    bio: 'Bot del servidor. Probá /help.',
  },
];

export const usersById: Record<string, User> = Object.fromEntries(users.map((u) => [u.id, u]));
