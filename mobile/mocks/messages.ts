import type { Message, Thread } from '@/api/types';

import { ME_ID } from './users';

/**
 * Historial de prueba. El contenido usa el mismo formato que el chat real:
 * markdown básico, `<@id>` para menciones y bloques de código con ```.
 */

const NOW = Date.now();
const ago = (minutes: number) => NOW - minutes * 60_000;

let seq = 0;
function msg(
  channelId: string,
  authorId: string,
  minutesAgo: number,
  content: string,
  extra: Partial<Message> = {},
): Message {
  seq += 1;
  const mentions = [...content.matchAll(/<@([\w-]+)>/g)].map((m) => m[1] ?? '');
  return {
    id: `m-${channelId}-${seq}`,
    channelId,
    authorId,
    content,
    createdAt: ago(minutesAgo),
    reactions: [],
    mentions,
    ...extra,
  };
}

// ─── Casa de Luis ─────────────────────────────────────────────────────────────

const general = [
  msg('ch-casa-general', 'u-luis', 190, 'Buenas! Prendí el nodo, ya pueden entrar 🎉'),
  msg('ch-casa-general', 'u-ana', 186, 'Llegué. ¿Alguien probó la app nueva del celu?'),
  msg('ch-casa-general', 'u-sofi', 180, 'Yo! El modo oscuro está **hermoso**', {
    reactions: [{ emoji: '🔥', userIds: ['u-ana', 'u-luis'] }],
  }),
  msg('ch-casa-general', 'u-nico', 95, 'Ojo que esta noche reinicio el router a las 23'),
  msg('ch-casa-general', 'u-luis', 60, `<@${ME_ID}> ¿te sumás a la charla de voz más tarde?`),
  msg('ch-casa-general', 'u-ana', 41, 'Les dejo el comando para ver la latencia del nodo:\n```bash\ncurl -w "%{time_total}\\n" -o /dev/null -s 192.168.1.50:7272/health\n```'),
  msg('ch-casa-general', 'u-marta', 30, 'Mañana gym a las 8, no se duerman 💪'),
  msg('ch-casa-general', 'u-sofi', 12, '¿Hacemos noche de juegos? Tengo ganas de algo cooperativo', {
    threadId: 't-juegos',
    reactions: [
      { emoji: '🎮', userIds: ['u-ana', 'u-luis', 'u-nico'] },
      { emoji: '👀', userIds: ['u-marta'] },
    ],
  }),
  msg('ch-casa-general', 'u-luis', 4, 'Dale, armo el canal de voz *gaming* 🕹️'),
];
const sofiId = general[7]?.id ?? '';
general.push(
  msg('ch-casa-general', 'u-ana', 2, 'Me sumo! Llevo los snacks', { replyToId: sofiId }),
);

const anuncios = [
  msg('ch-casa-anuncios', 'u-luis', 60 * 24 * 3, '**Bienvenidos a Casa de Luis** 🏠\nEl servidor vive en mi compu: si se cae, es porque se cortó la luz.'),
  msg('ch-casa-anuncios', 'u-luis', 60 * 24, '> Actualicé el nodo a la versión nueva.\nAhora los canales de voz andan *mucho* mejor.', {
    reactions: [{ emoji: '🚀', userIds: ['u-ana', 'u-sofi', 'u-nico', 'u-marta'] }],
  }),
];

const juegos = [
  msg('ch-casa-juegos', 'u-ana', 300, '¿Alguien tiene Deep Rock Galactic?'),
  msg('ch-casa-juegos', 'u-nico', 290, 'Yo, ROCK AND STONE ⛏️'),
  msg('ch-casa-juegos', 'u-sofi', 120, 'Esta noche hay speedrun de Celeste en mi stream'),
];

// ─── Hypr Lab ─────────────────────────────────────────────────────────────────

const dotfiles = [
  msg('ch-hypr-dotfiles', 'u-vale', 240, 'Subí mi config nueva de **Hyprland** con gaps y blur:'),
  msg(
    'ch-hypr-dotfiles',
    'u-vale',
    239,
    '```ini\ngeneral {\n    gaps_in = 8\n    gaps_out = 12\n    border_size = 1\n    col.active_border = rgba(00e5ffee) rgba(a855f7ee) 45deg\n}\n\ndecoration {\n    rounding = 16\n    blur {\n        enabled = true\n        size = 8\n        passes = 3\n    }\n}\n```',
    { reactions: [{ emoji: '😍', userIds: ['u-ana', 'u-juan', ME_ID] }] },
  ),
  msg('ch-hypr-dotfiles', 'u-ana', 230, 'Ese degradé en el borde activo es *chef kiss*. ¿Cómo hiciste la barra?'),
  msg(
    'ch-hypr-dotfiles',
    'u-vale',
    228,
    'Waybar con módulos custom:\n```json\n{\n  "modules-left": ["hyprland/workspaces"],\n  "modules-center": ["clock"],\n  "modules-right": ["network", "battery", "custom/latency"]\n}\n```',
    { threadId: 't-waybar' },
  ),
  msg('ch-hypr-dotfiles', 'u-juan', 90, 'Tip: con `wofi --show drun` y un CSS con `backdrop-filter` queda igual que la paleta de comandos de esta app'),
  msg('ch-hypr-dotfiles', 'u-nico', 35, `<@${ME_ID}> vos que estás en la app móvil, ¿el blur anda bien en Android?`),
  msg('ch-hypr-dotfiles', 'u-bot', 34, '🤖 Recordatorio: los dotfiles van en un repo, no en capturas de pantalla.'),
];

const setups = [
  msg('ch-hypr-setups', 'u-ana', 500, 'Mi setup: Hyprland + waybar + tema Tokyo Night ✨'),
  msg('ch-hypr-setups', 'u-caro', 480, 'Qué limpio! Yo sigo con i3 pero me están convenciendo'),
];

// ─── Otros ────────────────────────────────────────────────────────────────────

const rutinas = [
  msg('ch-gym-rutinas', 'u-marta', 600, '**Martes — piernas**\n- Sentadilla 4x8\n- Peso muerto rumano 3x10\n- Estocadas 3x12'),
  msg('ch-gym-rutinas', 'u-juan', 580, 'La sentadilla 4x8 me va a matar 💀'),
];

const gymGeneral = [msg('ch-gym-general', 'u-sofi', 50, '¿Mañana a las 8 entonces?')];

const recopBackend = [
  msg('ch-recop-backend', 'u-nico', 200, 'Mergeado el proceso por grupo: cada servidor corre en su puerto 🎉'),
  msg('ch-recop-backend', 'u-luis', 190, 'Falta el WebSocket de `/api/v1/ws` para tener chat en tiempo real'),
];

// ─── Hilos ────────────────────────────────────────────────────────────────────

export const threads: Thread[] = [
  { id: 't-juegos', channelId: 'ch-casa-general', parentMessageId: general[7]?.id ?? '', name: 'Noche de juegos' },
  { id: 't-waybar', channelId: 'ch-hypr-dotfiles', parentMessageId: dotfiles[3]?.id ?? '', name: 'Config de waybar' },
];

const threadJuegos = [
  msg('t-juegos', 'u-ana', 11, 'Voto por It Takes Two'),
  msg('t-juegos', 'u-nico', 10, 'Deep Rock! Somos 4 justo'),
  msg('t-juegos', 'u-luis', 9, 'Hagamos las dos, arrancamos 22:30'),
];

const threadWaybar = [
  msg('t-waybar', 'u-juan', 220, '¿El módulo de latencia es un script?'),
  msg('t-waybar', 'u-vale', 219, 'Sí, un `ping -c1` cada 5 segundos y saco el tiempo con awk'),
];

// ─── DMs ──────────────────────────────────────────────────────────────────────

const dmAna = [
  msg('dm-u-ana', 'u-ana', 70, 'Che, ¿me pasás tu config de waybar?'),
  msg('dm-u-ana', ME_ID, 68, 'Ahí te la mando, está en mi repo de dotfiles'),
  msg('dm-u-ana', 'u-ana', 3, 'Gracias!! Ya la estoy probando 🙌'),
];

const dmLuis = [
  msg('dm-u-luis', 'u-luis', 300, 'Te hice admin en el server, cualquier cosa avisame'),
  msg('dm-u-luis', ME_ID, 295, 'Genial, gracias!'),
];

const dmNico = [msg('dm-u-nico', 'u-nico', 1500, '¿Viste el PR del proceso por grupo?')];

// ─── Historia vieja para la paginación ────────────────────────────────────────

const FILLER = [
  'jaja',
  '¿alguien sabe si hay luz en Palermo?',
  'mañana sigo',
  'buenísimo',
  'me voy a dormir, nos vemos',
  'eso pasa por no hacer backup 😅',
  'subí la captura al canal de setups',
  '¿quién se olvidó la campera acá?',
  '+1',
  'probá reiniciando el router',
  'qué buena canción',
  '¿a qué hora arrancamos?',
];
const FILLER_AUTHORS = ['u-luis', 'u-ana', 'u-sofi', 'u-nico', 'u-marta'];

function history(channelId: string, count: number, startMinutesAgo: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    msg(
      channelId,
      FILLER_AUTHORS[i % FILLER_AUTHORS.length] ?? 'u-luis',
      startMinutesAgo + (count - i) * 37,
      FILLER[(i * 7) % FILLER.length] ?? '…',
    ),
  );
}

/** Todos los mensajes de prueba, por canal / hilo / DM, del más viejo al más nuevo. */
export const initialMessages: Record<string, Message[]> = {
  'ch-casa-general': [...history('ch-casa-general', 60, 200), ...general],
  'ch-casa-anuncios': anuncios,
  'ch-casa-juegos': juegos,
  'ch-hypr-dotfiles': [...history('ch-hypr-dotfiles', 30, 260), ...dotfiles],
  'ch-hypr-setups': setups,
  'ch-gym-rutinas': rutinas,
  'ch-gym-general': gymGeneral,
  'ch-recop-backend': recopBackend,
  't-juegos': threadJuegos,
  't-waybar': threadWaybar,
  'dm-u-ana': dmAna,
  'dm-u-luis': dmLuis,
  'dm-u-nico': dmNico,
};

/** Respuestas que el socket de prueba usa para simular que alguien contesta. */
export const cannedReplies = [
  'jaja totalmente',
  'dale, me sumo',
  '¿en serio? 👀',
  'eso mismo pensaba',
  'ahora no puedo, en un rato',
  'buenísimo 🔥',
  'mandá captura!',
  'qué buena idea',
];
