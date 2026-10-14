/** Comandos `/` del chat. La lógica de cada uno vive en store/messages.ts. */
export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const slashCommands: SlashCommand[] = [
  { name: 'help', description: 'Lista los comandos disponibles' },
  { name: 'ping', description: 'Mide la latencia con el servidor' },
  { name: 'shrug', args: '[texto]', description: 'Agrega ¯\\_(ツ)_/¯ al final' },
  { name: 'tableflip', args: '[texto]', description: 'Agrega (╯°□°)╯︵ ┻━┻' },
  { name: 'unflip', args: '[texto]', description: 'Agrega ┬─┬ ノ( ゜-゜ノ)' },
  { name: 'me', args: '<acción>', description: 'Escribe una acción en cursiva' },
  { name: 'status', args: '<texto>', description: 'Cambia tu estado personalizado' },
  { name: 'nick', args: '<nombre>', description: 'Cambia tu nombre visible' },
  { name: 'clear', description: 'Limpia el chat en esta pantalla (solo para vos)' },
];
