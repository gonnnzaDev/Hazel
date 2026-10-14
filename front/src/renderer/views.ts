// Dibujo de la interfaz. Cuatro columnas, como Discord:
//
//   rail      → tus servidores (y "Mi nodo" arriba de todo)
//   sidebar   → canales del servidor, o el menú de tu nodo
//   main      → el chat, o el panel de tu nodo
//   members   → quién está en el servidor
//
// Las funciones leen `state` y llaman a las acciones que les pasa app.ts con
// `bindActions`. No guardan estado propio, salvo el borrador de cada canal.

import { icon } from './icons';
import { state, type ChatMessage, type ServerState } from './state';
import * as store from './store';
import type { Channel, Member, Role, Server, Session } from './types';
import * as ui from './ui';
import {
  append,
  byId,
  clear,
  colorFor,
  formatDay,
  formatStamp,
  formatTime,
  h,
  sameDay,
  serverInitials,
  type Child,
} from './util';

/** Lo que las vistas le piden a la app. Lo implementa app.ts. */
export interface Actions {
  openHome(): void;
  openSession(key: string): void;
  selectChannel(channelId: string): void;
  toggleMembers(): void;
  refreshNode(options?: { announce?: boolean }): Promise<void>;
  inviteAddressFor(server: Server): string;
  startServer(server: Server): Promise<void>;
  stopServer(server: Server): Promise<void>;
  deleteServer(server: Server): Promise<void>;
  openOwnedServer(server: Server): void;
  showJoin(): void;
  showRejoin(): Promise<void>;
  showAddServer(): void;
  showCreateServer(): void;
  sendMessage(content: string): Promise<void>;
  loadOlder(): Promise<void>;
  joinVoice(channel: Channel): Promise<void>;
  leaveCall(): void;
  setRole(member: Member, role: Exclude<Role, 'owner'>): Promise<void>;
  kick(member: Member): Promise<void>;
  showEditDisplayName(): void;
  showInvite(): void;
  leaveServer(): Promise<void>;
  forgetSession(key: string): void;
  showSettings(): void;
}

// Las acciones llegan desde app.ts en vez de importarse: así no hay una
// dependencia circular entre las vistas y la app.
let actions: Actions;

export function bindActions(implementation: Actions): void {
  actions = implementation;
}

// Mensajes del mismo autor con menos de esto entre sí se agrupan bajo un
// solo encabezado.
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2000;

const ROLE_LABELS: Record<Role, string> = { owner: 'Dueño', admin: 'Administrador', member: 'Miembro' };
const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

const STATUS: Record<Server['status'], { label: string; cls: string }> = {
  active: { label: 'Encendido', cls: 'is-on' },
  inactive: { label: 'Apagado', cls: 'is-off' },
  creating: { label: 'Arrancando…', cls: 'is-busy' },
  deleted: { label: 'Eliminado', cls: 'is-off' },
};

const BUSY_LABELS = { start: 'Encendiendo…', stop: 'Apagando…', delete: 'Eliminando…' } as const;

const LOGO = '../../assets/icon.svg';

// ─── Todo ─────────────────────────────────────────────────────────────────────

export function renderAll(): void {
  const showMembers = state.view === 'server' && state.showMembers;
  byId('app').classList.toggle('no-members', !showMembers);

  renderRail();
  if (state.view === 'home') {
    renderHomeSidebar();
    renderHomeMain();
    clear(byId('members'));
  } else {
    renderServerSidebar();
    renderServerMain();
    renderMembers();
  }
  updateTitle();
}

function updateTitle(): void {
  const session = currentSession();
  document.title = state.view === 'server' && session ? `${session.name} · Recop` : 'Recop';
}

export function currentSession(): Session | null {
  return state.sessionKey ? store.getSession(state.sessionKey) : null;
}

export function serverState(): ServerState | null {
  return state.sessionKey ? (state.servers[state.sessionKey] ?? null) : null;
}

// ─── Rail ─────────────────────────────────────────────────────────────────────

interface RailItemOptions {
  active?: boolean;
  title: string;
  content: Child;
  onClick: () => void;
  variant?: 'home' | 'action';
  dim?: boolean;
  inCall?: boolean;
}

export function renderRail(): void {
  const rail = clear(byId('rail'));

  append(
    rail,
    railItem({
      active: state.view === 'home',
      title: 'Mi nodo',
      content: h('img', { class: 'rail-logo', src: LOGO, alt: '' }),
      onClick: () => actions.openHome(),
      variant: 'home',
    }),
    h('div', { class: 'rail-sep' }),
  );

  for (const session of store.listSessions()) {
    const ss = state.servers[session.key];
    const call = state.call;
    append(
      rail,
      railItem({
        active: state.view === 'server' && state.sessionKey === session.key,
        title: session.name,
        content: serverInitials(session.name),
        onClick: () => actions.openSession(session.key),
        dim: ss ? !ss.reachable : false,
        inCall: Boolean(call && call.baseUrl === session.baseUrl && call.serverId === session.serverId),
      }),
    );
  }

  append(
    rail,
    railItem({
      title: 'Agregar un servidor',
      content: icon('plus', 22),
      onClick: () => actions.showAddServer(),
      variant: 'action',
    }),
  );
}

function railItem({
  active,
  title,
  content,
  onClick,
  variant,
  dim,
  inCall,
}: RailItemOptions): HTMLDivElement {
  const classes = ['rail-btn'];
  if (variant) classes.push(`rail-${variant}`);
  if (dim) classes.push('is-dim');
  return h(
    'div',
    { class: `rail-item${active ? ' is-active' : ''}` },
    h('span', { class: 'rail-pill' }),
    h(
      'button',
      {
        class: classes.join(' '),
        title,
        'aria-label': title,
        'aria-current': active ? 'page' : null,
        onclick: onClick,
      },
      content,
      inCall
        ? h('span', { class: 'rail-badge', title: 'Estás en una llamada acá' }, icon('volume', 12))
        : null,
    ),
  );
}

// ─── Paneles de abajo del sidebar ─────────────────────────────────────────────

function voicePanel(): HTMLElement | null {
  const call = state.call;
  if (!call) return null;
  const connected = call.state === 'connected';
  const where = `${call.channelName} / ${call.serverName}`;
  return h(
    'div',
    { class: 'voice-panel' },
    h(
      'div',
      { class: 'voice-panel-info' },
      h(
        'div',
        { class: `voice-panel-status${connected ? '' : ' is-connecting'}` },
        connected ? 'Voz conectada' : 'Conectando…',
      ),
      h('div', { class: 'voice-panel-where', title: where }, where),
    ),
    h(
      'button',
      {
        class: 'icon-btn danger',
        title: 'Desconectarse',
        'aria-label': 'Desconectarse',
        onclick: () => actions.leaveCall(),
      },
      icon('phoneOff', 18),
    ),
  );
}

function userPanel(): HTMLElement {
  const session = state.view === 'server' ? currentSession() : null;
  const call = state.call;

  let identity: HTMLElement;
  if (session) {
    const me = session.member;
    const callHere = call && call.serverId === session.serverId ? call : null;
    identity = h(
      'button',
      {
        class: 'user-panel-id',
        title: 'Cambiar mi nombre visible',
        onclick: () => actions.showEditDisplayName(),
      },
      ui.avatar(me.display_name, me.nickname, {
        size: 'sm',
        speaking: callHere ? callHere.isSpeaking(callHere.selfId) : false,
        speaker: callHere ? callHere.selfId : null,
      }),
      h(
        'span',
        { class: 'user-panel-names' },
        h('strong', null, me.display_name),
        h('small', null, `@${me.nickname}`),
      ),
    );
  } else {
    identity = h(
      'div',
      { class: 'user-panel-id is-static' },
      h('img', { class: 'user-panel-logo', src: LOGO, alt: '' }),
      h(
        'span',
        { class: 'user-panel-names' },
        h('strong', null, 'Recop'),
        h('small', null, nodeStatusText()),
      ),
    );
  }

  const buttons: HTMLElement[] = [];
  if (call) {
    buttons.push(
      h(
        'button',
        {
          class: `icon-btn${call.muted || call.deafened ? ' is-off' : ''}`,
          title: call.micOn ? 'Silenciar micrófono' : 'Activar micrófono',
          'aria-pressed': String(!call.micOn),
          onclick: () => call.toggleMute(),
        },
        icon(call.micOn ? 'mic' : 'micOff', 18),
      ),
      h(
        'button',
        {
          class: `icon-btn${call.deafened ? ' is-off' : ''}`,
          title: call.deafened ? 'Activar audio' : 'Ensordecer',
          'aria-pressed': String(call.deafened),
          onclick: () => call.toggleDeafen(),
        },
        icon(call.deafened ? 'headphonesOff' : 'headphones', 18),
      ),
    );
  }
  buttons.push(
    h(
      'button',
      { class: 'icon-btn', title: 'Configuración', onclick: () => actions.showSettings() },
      icon('settings', 18),
    ),
  );

  return h('div', { class: 'user-panel' }, identity, h('div', { class: 'user-panel-actions' }, buttons));
}

function nodeStatusText(): string {
  if (state.node.status === 'online') return 'Nodo conectado';
  if (state.node.status === 'offline') return 'Nodo sin conexión';
  return 'Buscando tu nodo…';
}

// ─── Inicio: sidebar ──────────────────────────────────────────────────────────

export function renderHomeSidebar(): void {
  const node = state.node;
  const settings = store.getSettings();
  const sidebar = clear(byId('sidebar'));

  const servers = node.servers;
  const running = servers.filter((s) => s.status === 'active').length;
  const statusLabel =
    node.status === 'online' ? 'Conectado' : node.status === 'offline' ? 'Sin conexión' : 'Buscando…';

  append(
    sidebar,
    h('div', { class: 'sidebar-header is-static' }, h('span', { class: 'sidebar-title' }, 'Mi nodo')),
    h(
      'div',
      { class: 'sidebar-scroll' },
      h(
        'nav',
        { class: 'nav-list' },
        h(
          'button',
          { class: 'nav-item is-active' },
          icon('server', 18),
          h('span', null, 'Mis servidores'),
          servers.length ? h('span', { class: 'nav-count' }, String(servers.length)) : null,
        ),
        h(
          'button',
          { class: 'nav-item', onclick: () => actions.showJoin() },
          icon('logIn', 18),
          h('span', null, 'Unirme a un servidor'),
        ),
        h(
          'button',
          { class: 'nav-item', onclick: () => actions.showSettings() },
          icon('settings', 18),
          h('span', null, 'Configuración'),
        ),
      ),
      h('div', { class: 'section-label' }, 'Tu nodo'),
      h(
        'dl',
        { class: 'node-facts' },
        fact(
          'Estado',
          h(
            'span',
            { class: `status-dot-text ${node.status === 'online' ? 'is-on' : 'is-off'}` },
            statusLabel,
          ),
        ),
        fact('Dirección', settings.nodeUrl.replace(/^https?:\/\//, '')),
        node.info ? fact('Versión', node.info.version) : null,
        node.status === 'online' ? fact('Encendidos', `${running} de ${servers.length}`) : null,
      ),
    ),
    voicePanel(),
    userPanel(),
  );
}

function fact(label: string, value: Child): HTMLDivElement {
  return h('div', { class: 'node-fact' }, h('dt', null, label), h('dd', null, value));
}

// ─── Inicio: panel del nodo ───────────────────────────────────────────────────

export function renderHomeMain(): void {
  const node = state.node;
  const main = clear(byId('main'));

  const header = h(
    'header',
    { class: 'main-header' },
    icon('server', 20),
    h('h1', { class: 'main-title' }, 'Mis servidores'),
    h('div', { class: 'main-header-spacer' }),
    node.status === 'online'
      ? h(
          'button',
          { class: 'btn btn-primary btn-sm', onclick: () => actions.showCreateServer() },
          icon('plus', 16),
          'Crear servidor',
        )
      : null,
  );

  let body: HTMLElement;
  if (node.status === 'loading') {
    body = h('div', { class: 'center-fill' }, h('div', { class: 'spinner', 'aria-label': 'Cargando' }));
  } else if (node.status === 'offline') {
    body = ui.emptyState({
      iconName: 'wifiOff',
      title: 'No encontramos tu nodo',
      text: `Recop busca tu nodo en ${store.getSettings().nodeUrl}. Arrancalo con "make api" o "docker compose up" y tocá Reintentar. Si solo querés entrar al servidor de un amigo, no necesitás un nodo.`,
      actions: [
        h(
          'button',
          { class: 'btn btn-primary', onclick: () => void actions.refreshNode({ announce: true }) },
          icon('refresh', 16),
          'Reintentar',
        ),
        h(
          'button',
          { class: 'btn btn-secondary', onclick: () => actions.showJoin() },
          'Unirme a un servidor',
        ),
        h('button', { class: 'btn btn-ghost', onclick: () => actions.showSettings() }, 'Cambiar dirección'),
      ],
    });
  } else if (!node.servers.length) {
    body = ui.emptyState({
      iconName: 'server',
      title: 'Todavía no tenés servidores',
      text: 'Creá uno, pasale la dirección a tus amigos y listo. Vive en tu compu: si la apagás, se apaga.',
      actions: [
        h(
          'button',
          { class: 'btn btn-primary', onclick: () => actions.showCreateServer() },
          icon('plus', 16),
          'Crear mi primer servidor',
        ),
        h('button', { class: 'btn btn-secondary', onclick: () => actions.showJoin() }, 'Unirme a uno'),
      ],
    });
  } else {
    body = h(
      'div',
      { class: 'page' },
      h(
        'p',
        { class: 'page-intro' },
        'Los servidores que corren en esta compu. Apagar uno no borra nada: cuando lo encendés, está todo como lo dejaste.',
      ),
      h('div', { class: 'server-list' }, node.servers.map(serverRow)),
    );
  }

  append(main, header, h('div', { class: 'main-body' }, body));
}

function serverRow(server: Server): HTMLDivElement {
  const busy = state.node.busy[server.id];
  const status = STATUS[server.status];
  const address = actions.inviteAddressFor(server);
  const on = server.status === 'active';

  return h(
    'div',
    { class: 'server-row' },
    h(
      'span',
      { class: 'server-row-icon', style: { background: colorFor(server.slug) } },
      serverInitials(server.name),
    ),
    h(
      'div',
      { class: 'server-row-info' },
      h(
        'div',
        { class: 'server-row-name' },
        server.name,
        h(
          'span',
          { class: `status-pill ${busy ? 'is-busy' : status.cls}` },
          busy ? BUSY_LABELS[busy] : status.label,
        ),
      ),
      h(
        'div',
        { class: 'server-row-address' },
        h(
          'button',
          {
            class: 'link-btn',
            title: 'Copiar dirección',
            onclick: () => void ui.copy(address, 'Dirección copiada. Pasásela a tus amigos.'),
          },
          address,
          icon('copy', 14),
        ),
      ),
    ),
    h(
      'div',
      { class: 'server-row-actions' },
      h(
        'button',
        {
          class: 'btn btn-secondary btn-sm',
          disabled: !on || Boolean(busy),
          onclick: () => actions.openOwnedServer(server),
        },
        'Abrir',
      ),
      h(
        'button',
        {
          class: `btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}`,
          disabled: Boolean(busy),
          onclick: () => void (on ? actions.stopServer(server) : actions.startServer(server)),
        },
        icon('power', 16),
        on ? 'Apagar' : 'Encender',
      ),
      h(
        'button',
        {
          class: 'icon-btn',
          title: 'Más opciones',
          disabled: Boolean(busy),
          onclick: (event) =>
            ui.popover(
              event.currentTarget as HTMLElement,
              [
                {
                  label: 'Copiar dirección',
                  icon: 'copy',
                  onClick: () => void ui.copy(address, 'Dirección copiada.'),
                },
                'separator',
                {
                  label: 'Eliminar servidor',
                  icon: 'trash',
                  danger: true,
                  onClick: () => void actions.deleteServer(server),
                },
              ],
              { align: 'end' },
            ),
        },
        icon('more', 18),
      ),
    ),
  );
}

// ─── Servidor: sidebar ────────────────────────────────────────────────────────

export function renderServerSidebar(): void {
  const session = currentSession();
  const ss = serverState();
  const sidebar = clear(byId('sidebar'));
  if (!session || !ss) return;

  const detail = ss.detail;
  const channels = detail ? [...detail.channels].sort((a, b) => a.position - b.position) : [];
  const text = channels.filter((c) => c.kind === 'text');
  const voice = channels.filter((c) => c.kind === 'voice');

  const header = h(
    'button',
    { class: 'sidebar-header', onclick: (event) => serverMenu(event.currentTarget as HTMLElement) },
    h('span', { class: 'sidebar-title' }, detail ? detail.name : session.name),
    icon('chevronDown', 18),
  );

  const list = h('div', { class: 'sidebar-scroll' });
  if (!detail) {
    append(
      list,
      h(
        'div',
        { class: 'sidebar-note' },
        ss.reachable ? 'Cargando canales…' : 'Sin conexión con el servidor.',
      ),
    );
  }
  if (text.length) {
    append(
      list,
      h('div', { class: 'section-label' }, 'Canales de texto'),
      text.map((channel) =>
        h(
          'button',
          {
            class: `channel${channel.id === ss.channelId ? ' is-active' : ''}`,
            onclick: () => actions.selectChannel(channel.id),
            title: channel.topic ?? channel.name,
          },
          icon('hash', 18),
          h('span', { class: 'channel-name' }, channel.name),
        ),
      ),
    );
  }
  if (voice.length) {
    append(
      list,
      h('div', { class: 'section-label' }, 'Canales de voz'),
      voice.map((channel) => voiceChannel(session, ss, channel)),
    );
  }

  append(sidebar, header, list, voicePanel(), userPanel());
}

function voiceChannel(session: Session, ss: ServerState, channel: Channel): HTMLDivElement {
  const call = state.call;
  const here =
    call &&
    call.serverId === session.serverId &&
    call.channelId === channel.id &&
    call.baseUrl === session.baseUrl
      ? call
      : null;
  const people = here ? here.list() : (ss.voice[channel.id] ?? []);

  return h(
    'div',
    { class: 'voice-channel' },
    h(
      'button',
      {
        class: `channel${here ? ' is-active' : ''}`,
        title: here ? 'Ya estás en este canal' : `Entrar a ${channel.name}`,
        onclick: () => {
          if (!here) void actions.joinVoice(channel);
        },
      },
      icon('volume', 18),
      h('span', { class: 'channel-name' }, channel.name),
    ),
    people.length
      ? h(
          'ul',
          { class: 'voice-people' },
          people.map((p) =>
            h(
              'li',
              { class: 'voice-person' },
              ui.avatar(p.display_name, p.nickname, {
                size: 'xs',
                speaking: here ? here.isSpeaking(p.member_id) : false,
                speaker: here ? p.member_id : null,
              }),
              h('span', { class: 'voice-person-name' }, p.display_name),
              p.mic === false
                ? h('span', { class: 'voice-person-muted', title: 'Micrófono apagado' }, icon('micOff', 14))
                : null,
            ),
          ),
        )
      : null,
  );
}

function serverMenu(anchor: HTMLElement): void {
  ui.popover(anchor, [
    { label: 'Invitar gente', icon: 'userPlus', onClick: () => actions.showInvite() },
    { label: 'Cambiar mi nombre visible', icon: 'edit', onClick: () => actions.showEditDisplayName() },
    'separator',
    { label: 'Salir del servidor', icon: 'logOut', danger: true, onClick: () => void actions.leaveServer() },
  ]);
}

// ─── Servidor: chat ───────────────────────────────────────────────────────────

export function currentChannel(ss: ServerState | null): Channel | null {
  if (!ss?.detail) return null;
  return ss.detail.channels.find((c) => c.id === ss.channelId) ?? null;
}

export function renderServerMain(): void {
  const main = clear(byId('main'));
  const session = currentSession();
  const ss = serverState();
  if (!session || !ss) return;

  const channel = currentChannel(ss);

  const header = h(
    'header',
    { class: 'main-header' },
    channel ? icon('hash', 20) : null,
    h('h1', { class: 'main-title' }, channel ? channel.name : session.name),
    channel?.topic ? h('span', { class: 'main-topic' }, channel.topic) : null,
    h('div', { class: 'main-header-spacer' }),
    h(
      'button',
      { class: 'icon-btn', title: 'Invitar gente', onclick: () => actions.showInvite() },
      icon('userPlus', 20),
    ),
    h(
      'button',
      {
        class: `icon-btn${state.showMembers ? ' is-on' : ''}`,
        title: state.showMembers ? 'Ocultar miembros' : 'Mostrar miembros',
        'aria-pressed': String(state.showMembers),
        onclick: () => actions.toggleMembers(),
      },
      icon('users', 20),
    ),
  );

  if (!channel) {
    const body = ss.detail
      ? ui.emptyState({
          iconName: 'hash',
          title: 'No hay canales de texto',
          text: 'Este servidor todavía no tiene canales para escribir.',
        })
      : h(
          'div',
          { class: 'center-fill' },
          ss.reachable ? h('div', { class: 'spinner' }) : unreachableNotice(session),
        );
    append(main, header, h('div', { class: 'main-body' }, body));
    return;
  }

  const banner = h('div', { id: 'chat-banner' });
  const scroller = h('div', {
    class: 'messages',
    id: 'messages',
    role: 'log',
    'aria-label': `Mensajes de #${channel.name}`,
  });
  append(main, header, banner, scroller, composer(session, channel));

  renderBanner();
  renderMessages({ forceBottom: true });
}

function unreachableNotice(session: Session): HTMLDivElement {
  return ui.emptyState({
    iconName: 'wifiOff',
    title: 'No se puede conectar',
    text: `${session.baseUrl.replace(/^https?:\/\//, '')} no responde. Puede que su dueño lo haya apagado. Reintentamos solos.`,
  });
}

export function renderBanner(): void {
  const el = document.getElementById('chat-banner');
  const ss = serverState();
  const session = currentSession();
  if (!el || !ss || !session) return;
  clear(el);

  if (ss.gone) {
    append(
      el,
      h(
        'div',
        { class: 'banner banner-error' },
        h('span', { class: 'banner-text' }, 'Este servidor ya no existe. Su dueño lo eliminó.'),
        h(
          'button',
          { class: 'btn btn-sm btn-danger', onclick: () => actions.forgetSession(session.key) },
          'Quitar de mi lista',
        ),
      ),
    );
  } else if (ss.sessionExpired) {
    append(
      el,
      h(
        'div',
        { class: 'banner banner-warning' },
        h('span', { class: 'banner-text' }, 'Tu sesión en este servidor venció.'),
        h(
          'button',
          { class: 'btn btn-sm btn-primary', onclick: () => void actions.showRejoin() },
          'Volver a entrar',
        ),
      ),
    );
  } else if (!ss.reachable) {
    append(
      el,
      h(
        'div',
        { class: 'banner banner-error' },
        icon('wifiOff', 16),
        h(
          'span',
          { class: 'banner-text' },
          'Sin conexión con el servidor. Puede estar apagado; reintentamos solos.',
        ),
      ),
    );
  }
}

function composer(session: Session, channel: Channel): HTMLFormElement {
  const draftKey = `${session.key}|${channel.id}`;
  const counter = h('span', { class: 'composer-counter', hidden: true });

  const textarea = h('textarea', {
    class: 'composer-input',
    id: 'composer',
    rows: 1,
    maxlength: MAX_MESSAGE_LENGTH,
    placeholder: `Escribí en #${channel.name}`,
    'aria-label': `Mensaje para #${channel.name}`,
  });
  textarea.value = state.drafts[draftKey] ?? '';

  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
    const left = MAX_MESSAGE_LENGTH - textarea.value.length;
    counter.hidden = left > 200;
    counter.textContent = String(left);
    counter.classList.toggle('is-low', left < 50);
  };

  textarea.addEventListener('input', () => {
    state.drafts[draftKey] = textarea.value;
    resize();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      const content = textarea.value.trim();
      if (!content) return;
      textarea.value = '';
      state.drafts[draftKey] = '';
      resize();
      void actions.sendMessage(content);
    }
  });

  setTimeout(() => {
    resize();
    textarea.focus();
  }, 0);

  return h(
    'form',
    { class: 'composer', onsubmit: (event) => event.preventDefault() },
    h('div', { class: 'composer-box' }, textarea, counter),
    h('div', { class: 'composer-hint' }, 'Enter para enviar · Shift + Enter para una línea nueva'),
  );
}

export interface RenderMessagesOptions {
  forceBottom?: boolean;
  /** Distancia al fondo que había antes de cargar mensajes viejos, para no mover la vista. */
  keepOffsetFrom?: number | null;
}

// Redibuja solo la lista de mensajes, sin tocar el campo de texto. Si estabas
// leyendo más arriba, no te mueve; si estabas abajo, te deja abajo.
export function renderMessages({
  forceBottom = false,
  keepOffsetFrom = null,
}: RenderMessagesOptions = {}): void {
  const scroller = document.getElementById('messages');
  const ss = serverState();
  const channel = currentChannel(ss);
  if (!scroller || !ss || !channel) return;

  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const thread = ss.messages[channel.id];
  clear(scroller);

  if (!thread?.loaded) {
    append(scroller, h('div', { class: 'center-fill' }, h('div', { class: 'spinner' })));
    return;
  }

  const items = thread.items;
  const hasOlder = thread.total > items.filter((m) => !m.pending).length;

  if (hasOlder) {
    append(
      scroller,
      h(
        'div',
        { class: 'load-older' },
        h(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            disabled: thread.loadingOlder,
            onclick: () => void actions.loadOlder(),
          },
          thread.loadingOlder ? 'Cargando…' : 'Cargar mensajes anteriores',
        ),
      ),
    );
  } else {
    append(
      scroller,
      h(
        'div',
        { class: 'channel-welcome' },
        h('div', { class: 'channel-welcome-icon' }, icon('hash', 36)),
        h('h2', null, `Te damos la bienvenida a #${channel.name}`),
        h('p', null, `Este es el comienzo del canal #${channel.name}.`),
      ),
    );
  }

  const members = membersByNick(ss);
  let previous: ChatMessage | null = null;
  for (const message of items) {
    const date = new Date(message.created_at);
    if (!previous || !sameDay(new Date(previous.created_at), date)) {
      append(scroller, h('div', { class: 'day-divider' }, h('span', null, formatDay(message.created_at))));
      previous = null;
    }
    const grouped =
      previous !== null &&
      previous.author_nickname === message.author_nickname &&
      date.getTime() - new Date(previous.created_at).getTime() < GROUP_WINDOW_MS;
    append(scroller, messageRow(message, members, grouped));
    previous = message;
  }

  if (keepOffsetFrom !== null) {
    scroller.scrollTop = scroller.scrollHeight - keepOffsetFrom;
  } else if (forceBottom || nearBottom) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function membersByNick(ss: ServerState): Map<string, Member> {
  return new Map(ss.members.map((member) => [member.nickname, member]));
}

function messageRow(message: ChatMessage, members: Map<string, Member>, grouped: boolean): HTMLDivElement {
  const author = members.get(message.author_nickname);
  const name = author ? author.display_name : message.author_nickname;
  const classes = ['message'];
  if (grouped) classes.push('is-grouped');
  if (message.pending) classes.push('is-pending');

  if (grouped) {
    return h(
      'div',
      { class: classes.join(' ') },
      h(
        'span',
        { class: 'message-gutter-time', title: formatStamp(message.created_at) },
        formatTime(message.created_at),
      ),
      h('div', { class: 'message-content' }, linkify(message.content)),
    );
  }

  return h(
    'div',
    { class: classes.join(' ') },
    ui.avatar(name, message.author_nickname),
    h(
      'div',
      { class: 'message-main' },
      h(
        'div',
        { class: 'message-head' },
        h('span', { class: 'message-author', title: `@${message.author_nickname}` }, name),
        author && author.role !== 'member'
          ? h('span', { class: `role-tag role-${author.role}` }, ROLE_LABELS[author.role])
          : null,
        h('time', { class: 'message-time', datetime: message.created_at }, formatStamp(message.created_at)),
      ),
      h('div', { class: 'message-content' }, linkify(message.content)),
    ),
  );
}

// Convierte las URLs en links. El resto queda como texto plano: nunca se
// interpreta HTML de un mensaje.
function linkify(text: string): Child[] {
  const parts: Child[] = [];
  const pattern = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(h('a', { href: match[0], target: '_blank', rel: 'noreferrer' }, match[0]));
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ─── Servidor: miembros ───────────────────────────────────────────────────────

const MEMBER_GROUPS: [Role, string][] = [
  ['owner', 'Dueño'],
  ['admin', 'Administradores'],
  ['member', 'Miembros'],
];

export function renderMembers(): void {
  const panel = clear(byId('members'));
  const ss = serverState();
  const session = currentSession();
  if (!state.showMembers || !ss || !session) return;

  const scroll = h('div', { class: 'members-scroll' });
  for (const [role, label] of MEMBER_GROUPS) {
    const people = ss.members.filter((m) => m.role === role);
    if (!people.length) continue;
    append(
      scroll,
      h('div', { class: 'section-label' }, `${label} — ${people.length}`),
      people.map((member) => memberRow(session, ss, member)),
    );
  }
  if (!ss.members.length) {
    append(
      scroll,
      h('div', { class: 'sidebar-note' }, ss.reachable ? 'Cargando miembros…' : 'Sin conexión.'),
    );
  }
  append(panel, scroll);
}

function memberRow(session: Session, ss: ServerState, member: Member): HTMLButtonElement {
  const isMe = member.nickname === session.member.nickname;
  return h(
    'button',
    {
      class: 'member',
      title: `@${member.nickname}`,
      onclick: (event) => memberMenu(event.currentTarget as HTMLElement, session, ss, member, isMe),
    },
    ui.avatar(member.display_name, member.nickname, { size: 'sm' }),
    h(
      'span',
      { class: 'member-names' },
      h(
        'span',
        { class: 'member-name' },
        member.display_name,
        isMe ? h('span', { class: 'muted' }, ' (vos)') : null,
      ),
      h('small', { class: 'member-nick' }, `@${member.nickname}`),
    ),
  );
}

function memberMenu(
  anchor: HTMLElement,
  session: Session,
  ss: ServerState,
  member: Member,
  isMe: boolean,
): void {
  const myRole = myRoleIn(session, ss);
  const canManage =
    !isMe && ROLE_RANK[myRole] >= ROLE_RANK.admin && ROLE_RANK[myRole] > ROLE_RANK[member.role];

  const items: ui.MenuEntry[] = [
    {
      label: `Copiar @${member.nickname}`,
      icon: 'copy',
      onClick: () => void ui.copy(`@${member.nickname}`, 'Nickname copiado.'),
    },
  ];
  if (isMe) {
    items.push({
      label: 'Cambiar mi nombre visible',
      icon: 'edit',
      onClick: () => actions.showEditDisplayName(),
    });
  }
  if (canManage && myRole === 'owner') {
    items.push(
      member.role === 'admin'
        ? {
            label: 'Quitar administrador',
            icon: 'shield',
            onClick: () => void actions.setRole(member, 'member'),
          }
        : {
            label: 'Hacer administrador',
            icon: 'shield',
            onClick: () => void actions.setRole(member, 'admin'),
          },
    );
  }
  if (canManage) {
    items.push('separator', {
      label: `Expulsar a ${member.display_name}`,
      icon: 'logOut',
      danger: true,
      onClick: () => void actions.kick(member),
    });
  }
  ui.popover(anchor, items, { align: 'end' });
}

function myRoleIn(session: Session, ss: ServerState): Role {
  const me = ss.members.find((m) => m.nickname === session.member.nickname);
  return (me ?? session.member).role;
}
