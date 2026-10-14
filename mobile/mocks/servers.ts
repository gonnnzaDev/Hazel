import type { Role, Server } from '@/api/types';

import { ME_ID } from './users';

// Roles con colores neón. Cada servidor arma los suyos a partir de estos.
const roles = {
  owner: { id: 'r-owner', name: 'Dueño', color: '#BFFF00', badge: 'star', position: 100 },
  admin: { id: 'r-admin', name: 'Admin', color: '#00E5FF', badge: 'shield', position: 50 },
  dev: { id: 'r-dev', name: 'Dev', color: '#A855F7', badge: 'code', position: 30 },
  ricer: { id: 'r-ricer', name: 'Ricer', color: '#FF4D6D', badge: 'zap', position: 20 },
  bot: { id: 'r-bot', name: 'Bot', color: '#FFB020', badge: 'cpu', position: 40 },
  member: { id: 'r-member', name: 'Miembro', color: '#8B98A9', position: 1 },
} satisfies Record<string, Role>;

/** Servidores en los que la persona ya está al entrar por primera vez. */
export const servers: Server[] = [
  {
    id: 's-casa',
    name: 'Casa de Luis',
    icon: '🏠',
    accent: '#00E5FF',
    banner: ['#0a2a3a', '#2a0f4a'],
    description: 'El servidor de siempre, corriendo en la compu de Luis.',
    inviteCode: 'casa-luis',
    ownerId: 'u-luis',
    roles: [roles.owner, roles.admin, roles.bot, roles.member],
    categories: [
      { id: 'c-casa-info', name: 'Información' },
      { id: 'c-casa-chat', name: 'Charla' },
      { id: 'c-casa-voz', name: 'Voz' },
    ],
    channels: [
      { id: 'ch-casa-anuncios', serverId: 's-casa', categoryId: 'c-casa-info', name: 'anuncios', type: 'announcement', topic: 'Lo importante. Solo escribe Luis.' },
      { id: 'ch-casa-general', serverId: 's-casa', categoryId: 'c-casa-chat', name: 'general', type: 'text', topic: 'De todo un poco' },
      { id: 'ch-casa-memes', serverId: 's-casa', categoryId: 'c-casa-chat', name: 'memes', type: 'text' },
      { id: 'ch-casa-juegos', serverId: 's-casa', categoryId: 'c-casa-chat', name: 'juegos', type: 'text', topic: '¿Quién se suma esta noche?' },
      { id: 'ch-casa-charla', serverId: 's-casa', categoryId: 'c-casa-voz', name: 'charla', type: 'voice' },
      { id: 'ch-casa-gaming', serverId: 's-casa', categoryId: 'c-casa-voz', name: 'gaming', type: 'voice' },
    ],
    members: [
      { userId: 'u-luis', roleIds: ['r-owner'] },
      { userId: 'u-ana', roleIds: ['r-admin'] },
      { userId: 'u-marta', roleIds: ['r-member'] },
      { userId: 'u-nico', roleIds: ['r-member'] },
      { userId: 'u-sofi', roleIds: ['r-member'] },
      { userId: 'u-tomi', roleIds: ['r-member'] },
      { userId: 'u-bot', roleIds: ['r-bot'] },
      { userId: ME_ID, roleIds: ['r-member'] },
    ],
  },
  {
    id: 's-hypr',
    name: 'Hypr Lab',
    icon: '◆',
    accent: '#A855F7',
    banner: ['#1a0b33', '#00323a'],
    description: 'Dotfiles, ricing y tiling WMs. Mostrá tu setup.',
    inviteCode: 'hypr-lab',
    ownerId: 'u-vale',
    roles: [roles.owner, roles.admin, roles.ricer, roles.dev, roles.bot, roles.member],
    categories: [
      { id: 'c-hypr-info', name: 'Bienvenida' },
      { id: 'c-hypr-rice', name: 'Ricing' },
      { id: 'c-hypr-voz', name: 'Voz' },
    ],
    channels: [
      { id: 'ch-hypr-reglas', serverId: 's-hypr', categoryId: 'c-hypr-info', name: 'reglas', type: 'announcement' },
      { id: 'ch-hypr-dotfiles', serverId: 's-hypr', categoryId: 'c-hypr-rice', name: 'dotfiles', type: 'text', topic: 'Configs de hyprland, waybar, wofi y amigos' },
      { id: 'ch-hypr-setups', serverId: 's-hypr', categoryId: 'c-hypr-rice', name: 'setups', type: 'text', topic: 'Capturas de tu escritorio' },
      { id: 'ch-hypr-ayuda', serverId: 's-hypr', categoryId: 'c-hypr-rice', name: 'ayuda', type: 'text' },
      { id: 'ch-hypr-lounge', serverId: 's-hypr', categoryId: 'c-hypr-voz', name: 'lounge', type: 'voice' },
    ],
    members: [
      { userId: 'u-vale', roleIds: ['r-owner', 'r-ricer'] },
      { userId: 'u-ana', roleIds: ['r-ricer'] },
      { userId: 'u-nico', roleIds: ['r-admin', 'r-dev'] },
      { userId: 'u-juan', roleIds: ['r-dev'] },
      { userId: 'u-caro', roleIds: ['r-member'] },
      { userId: 'u-bot', roleIds: ['r-bot'] },
      { userId: ME_ID, roleIds: ['r-dev'] },
    ],
  },
  {
    id: 's-gym',
    name: 'Gym de Martes',
    icon: '🏋️',
    accent: '#BFFF00',
    banner: ['#1d2a05', '#0a0e14'],
    description: 'Rutinas, horarios y excusas.',
    inviteCode: 'gym-martes',
    ownerId: 'u-marta',
    roles: [roles.owner, roles.member],
    categories: [
      { id: 'c-gym-chat', name: 'General' },
      { id: 'c-gym-voz', name: 'Voz' },
    ],
    channels: [
      { id: 'ch-gym-general', serverId: 's-gym', categoryId: 'c-gym-chat', name: 'general', type: 'text' },
      { id: 'ch-gym-rutinas', serverId: 's-gym', categoryId: 'c-gym-chat', name: 'rutinas', type: 'text', topic: 'Una rutina por mensaje' },
      { id: 'ch-gym-vestuario', serverId: 's-gym', categoryId: 'c-gym-voz', name: 'vestuario', type: 'voice' },
    ],
    members: [
      { userId: 'u-marta', roleIds: ['r-owner'] },
      { userId: 'u-juan', roleIds: ['r-member'] },
      { userId: 'u-sofi', roleIds: ['r-member'] },
      { userId: ME_ID, roleIds: ['r-member'] },
    ],
  },
];

/**
 * Servidores a los que se puede entrar con un código de invitación. Sirven
 * para probar "Unirse" y la selección de servidor inicial.
 */
export const discoverableServers: Server[] = [
  {
    id: 's-recop',
    name: 'Recop Dev',
    icon: 'R',
    accent: '#FF4D6D',
    banner: ['#3a0a1a', '#0a2a3a'],
    description: 'Donde se construye Recop. Issues, PRs y mate.',
    inviteCode: 'recop-dev',
    ownerId: 'u-nico',
    roles: [roles.owner, roles.dev, roles.member],
    categories: [
      { id: 'c-recop-dev', name: 'Desarrollo' },
      { id: 'c-recop-voz', name: 'Voz' },
    ],
    channels: [
      { id: 'ch-recop-releases', serverId: 's-recop', categoryId: 'c-recop-dev', name: 'releases', type: 'announcement' },
      { id: 'ch-recop-backend', serverId: 's-recop', categoryId: 'c-recop-dev', name: 'backend', type: 'text', topic: 'FastAPI, Postgres y Kafka' },
      { id: 'ch-recop-mobile', serverId: 's-recop', categoryId: 'c-recop-dev', name: 'mobile', type: 'text', topic: 'Esta app' },
      { id: 'ch-recop-daily', serverId: 's-recop', categoryId: 'c-recop-voz', name: 'daily', type: 'voice' },
    ],
    members: [
      { userId: 'u-nico', roleIds: ['r-owner', 'r-dev'] },
      { userId: 'u-luis', roleIds: ['r-dev'] },
      { userId: 'u-vale', roleIds: ['r-dev'] },
      { userId: ME_ID, roleIds: ['r-member'] },
    ],
  },
];

/** Quién está en cada canal de voz al arrancar. */
export const initialVoiceStates: Record<string, string[]> = {
  'ch-casa-charla': ['u-luis', 'u-ana', 'u-sofi'],
  'ch-hypr-lounge': ['u-vale', 'u-nico'],
  'ch-gym-vestuario': [],
  'ch-casa-gaming': [],
};
