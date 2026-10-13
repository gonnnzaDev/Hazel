// Dibujo de la interfaz. Cuatro columnas, como Discord:
//
//   rail      → tus servidores (y "Mi nodo" arriba de todo)
//   sidebar   → canales del servidor, o el menú de tu nodo
//   main      → el chat, o el panel de tu nodo
//   members   → quién está en el servidor
//
// Las funciones leen `Recop.state` y llaman a `Recop.actions`. No guardan
// estado propio, salvo el borrador de cada canal.

(function (R) {
  'use strict';

  // `append` del util y no el nativo: acepta arreglos y descarta null.
  const { h, append, clear, initials, serverInitials, formatTime, formatDay, formatStamp, sameDay } = R.util;
  const { icon } = R.icons;
  const ui = R.ui;

  const $ = (id) => document.getElementById(id);
  const actions = () => R.actions;

  // Mensajes del mismo autor con menos de esto entre sí se agrupan bajo un
  // solo encabezado.
  const GROUP_WINDOW_MS = 7 * 60 * 1000;
  const MAX_MESSAGE_LENGTH = 2000;

  const ROLE_LABELS = { owner: 'Dueño', admin: 'Administrador', member: 'Miembro' };
  const ROLE_RANK = { owner: 3, admin: 2, member: 1 };

  const STATUS = {
    active: { label: 'Encendido', cls: 'is-on' },
    inactive: { label: 'Apagado', cls: 'is-off' },
    creating: { label: 'Arrancando…', cls: 'is-busy' },
    deleted: { label: 'Eliminado', cls: 'is-off' },
  };

  // ─── Todo ─────────────────────────────────────────────────────────────────

  function renderAll() {
    const state = R.state;
    const app = $('app');
    const showMembers = state.view === 'server' && state.showMembers;
    app.classList.toggle('no-members', !showMembers);

    renderRail();
    if (state.view === 'home') {
      renderHomeSidebar();
      renderHomeMain();
      clear($('members'));
    } else {
      renderServerSidebar();
      renderServerMain();
      renderMembers();
    }
    updateTitle();
  }

  function updateTitle() {
    const state = R.state;
    const session = currentSession();
    document.title = state.view === 'server' && session ? `${session.name} · Recop` : 'Recop';
  }

  function currentSession() {
    return R.state.sessionKey ? R.store.getSession(R.state.sessionKey) : null;
  }

  function serverState() {
    return R.state.servers[R.state.sessionKey] || null;
  }

  // ─── Rail ─────────────────────────────────────────────────────────────────

  function renderRail() {
    const state = R.state;
    const rail = clear($('rail'));

    append(
      rail,
      railItem({
        active: state.view === 'home',
        title: 'Mi nodo',
        content: h('img', { class: 'rail-logo', src: '../../assets/icon.svg', alt: '' }),
        onClick: () => actions().openHome(),
        variant: 'home',
      }),
      h('div', { class: 'rail-sep' }),
    );

    for (const session of R.store.listSessions()) {
      const ss = state.servers[session.key];
      append(
        rail,
        railItem({
          active: state.view === 'server' && state.sessionKey === session.key,
          title: session.name,
          content: serverInitials(session.name),
          onClick: () => actions().openSession(session.key),
          dim: ss && !ss.reachable,
          inCall:
            state.call && state.call.baseUrl === session.baseUrl && state.call.serverId === session.serverId,
        }),
      );
    }

    append(
      rail,
      railItem({
        title: 'Agregar un servidor',
        content: icon('plus', 22),
        onClick: () => actions().showAddServer(),
        variant: 'action',
      }),
    );
  }

  function railItem({ active, title, content, onClick, variant, dim, inCall }) {
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

  // ─── Paneles de abajo del sidebar ─────────────────────────────────────────

  function voicePanel() {
    const call = R.state.call;
    if (!call) return null;
    const connected = call.state === 'connected';
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
        h(
          'div',
          { class: 'voice-panel-where', title: `${call.channelName} / ${call.serverName}` },
          `${call.channelName} / ${call.serverName}`,
        ),
      ),
      h(
        'button',
        {
          class: 'icon-btn danger',
          title: 'Desconectarse',
          'aria-label': 'Desconectarse',
          onclick: () => actions().leaveCall(),
        },
        icon('phoneOff', 18),
      ),
    );
  }

  function userPanel() {
    const state = R.state;
    const session = state.view === 'server' ? currentSession() : null;
    const call = state.call;

    let identity;
    if (session) {
      const me = session.member;
      identity = h(
        'button',
        {
          class: 'user-panel-id',
          title: 'Cambiar mi nombre visible',
          onclick: () => actions().showEditDisplayName(),
        },
        ui.avatar(me.display_name, me.nickname, {
          size: 'sm',
          speaking: Boolean(call && call.serverId === session.serverId && call.isSpeaking(call.selfId)),
          speaker: call && call.serverId === session.serverId ? call.selfId : null,
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
        h('img', { class: 'user-panel-logo', src: '../../assets/icon.svg', alt: '' }),
        h(
          'span',
          { class: 'user-panel-names' },
          h('strong', null, 'Recop'),
          h('small', null, nodeStatusText()),
        ),
      );
    }

    const buttons = [];
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
        { class: 'icon-btn', title: 'Configuración', onclick: () => actions().showSettings() },
        icon('settings', 18),
      ),
    );

    return h('div', { class: 'user-panel' }, identity, h('div', { class: 'user-panel-actions' }, buttons));
  }

  function nodeStatusText() {
    const node = R.state.node;
    if (node.status === 'online') return 'Nodo conectado';
    if (node.status === 'offline') return 'Nodo sin conexión';
    return 'Buscando tu nodo…';
  }

  // ─── Inicio: sidebar ──────────────────────────────────────────────────────

  function renderHomeSidebar() {
    const node = R.state.node;
    const settings = R.store.getSettings();
    const sidebar = clear($('sidebar'));

    const servers = node.servers || [];
    const running = servers.filter((s) => s.status === 'active').length;

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
            { class: 'nav-item', onclick: () => actions().showJoin() },
            icon('logIn', 18),
            h('span', null, 'Unirme a un servidor'),
          ),
          h(
            'button',
            { class: 'nav-item', onclick: () => actions().showSettings() },
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
              node.status === 'online'
                ? 'Conectado'
                : node.status === 'offline'
                  ? 'Sin conexión'
                  : 'Buscando…',
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

  function fact(label, value) {
    return h('div', { class: 'node-fact' }, h('dt', null, label), h('dd', null, value));
  }

  // ─── Inicio: panel del nodo ───────────────────────────────────────────────

  function renderHomeMain() {
    const node = R.state.node;
    const main = clear($('main'));

    const header = h(
      'header',
      { class: 'main-header' },
      icon('server', 20),
      h('h1', { class: 'main-title' }, 'Mis servidores'),
      h('div', { class: 'main-header-spacer' }),
      node.status === 'online'
        ? h(
            'button',
            { class: 'btn btn-primary btn-sm', onclick: () => actions().showCreateServer() },
            icon('plus', 16),
            'Crear servidor',
          )
        : null,
    );

    let body;
    if (node.status === 'loading') {
      body = h('div', { class: 'center-fill' }, h('div', { class: 'spinner', 'aria-label': 'Cargando' }));
    } else if (node.status === 'offline') {
      body = ui.emptyState({
        iconName: 'wifiOff',
        title: 'No encontramos tu nodo',
        text: `Recop busca tu nodo en ${R.store.getSettings().nodeUrl}. Arrancalo con "make api" o "docker compose up" y tocá Reintentar. Si solo querés entrar al servidor de un amigo, no necesitás un nodo.`,
        actions: [
          h(
            'button',
            { class: 'btn btn-primary', onclick: () => actions().refreshNode({ announce: true }) },
            icon('refresh', 16),
            'Reintentar',
          ),
          h(
            'button',
            { class: 'btn btn-secondary', onclick: () => actions().showJoin() },
            'Unirme a un servidor',
          ),
          h(
            'button',
            { class: 'btn btn-ghost', onclick: () => actions().showSettings() },
            'Cambiar dirección',
          ),
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
            { class: 'btn btn-primary', onclick: () => actions().showCreateServer() },
            icon('plus', 16),
            'Crear mi primer servidor',
          ),
          h('button', { class: 'btn btn-secondary', onclick: () => actions().showJoin() }, 'Unirme a uno'),
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

  function serverRow(server) {
    const node = R.state.node;
    const busy = node.busy[server.id];
    const status = STATUS[server.status] || STATUS.inactive;
    const address = R.actions.inviteAddressFor(server);
    const on = server.status === 'active';

    return h(
      'div',
      { class: 'server-row' },
      h(
        'span',
        { class: 'server-row-icon', style: { background: R.util.colorFor(server.slug) } },
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
            busy ? busyLabel(busy) : status.label,
          ),
        ),
        h(
          'div',
          { class: 'server-row-address' },
          address
            ? h(
                'button',
                {
                  class: 'link-btn',
                  title: 'Copiar dirección',
                  onclick: () => ui.copy(address, 'Dirección copiada. Pasásela a tus amigos.'),
                },
                address,
                icon('copy', 14),
              )
            : h('span', { class: 'muted' }, `Puerto ${server.bind_port}`),
        ),
      ),
      h(
        'div',
        { class: 'server-row-actions' },
        h(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            disabled: !on || busy,
            onclick: () => actions().openOwnedServer(server),
          },
          'Abrir',
        ),
        h(
          'button',
          {
            class: `btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}`,
            disabled: Boolean(busy),
            onclick: () => (on ? actions().stopServer(server) : actions().startServer(server)),
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
                event.currentTarget,
                [
                  address
                    ? {
                        label: 'Copiar dirección',
                        icon: 'copy',
                        onClick: () => ui.copy(address, 'Dirección copiada.'),
                      }
                    : null,
                  'separator',
                  {
                    label: 'Eliminar servidor',
                    icon: 'trash',
                    danger: true,
                    onClick: () => actions().deleteServer(server),
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

  function busyLabel(kind) {
    return { start: 'Encendiendo…', stop: 'Apagando…', delete: 'Eliminando…' }[kind] || 'Un momento…';
  }

  // ─── Servidor: sidebar ────────────────────────────────────────────────────

  function renderServerSidebar() {
    const session = currentSession();
    const ss = serverState();
    const sidebar = clear($('sidebar'));
    if (!session || !ss) return;

    const detail = ss.detail;
    const channels = detail ? [...detail.channels].sort((a, b) => a.position - b.position) : [];
    const text = channels.filter((c) => c.kind === 'text');
    const voice = channels.filter((c) => c.kind === 'voice');

    const header = h(
      'button',
      { class: 'sidebar-header', onclick: (event) => serverMenu(event.currentTarget) },
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
              onclick: () => actions().selectChannel(channel.id),
              title: channel.topic || channel.name,
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

  function voiceChannel(session, ss, channel) {
    const call = R.state.call;
    const here =
      call &&
      call.serverId === session.serverId &&
      call.channelId === channel.id &&
      call.baseUrl === session.baseUrl;
    const people = here ? call.list() : ss.voice[channel.id] || [];

    return h(
      'div',
      { class: 'voice-channel' },
      h(
        'button',
        {
          class: `channel${here ? ' is-active' : ''}`,
          title: here ? 'Ya estás en este canal' : `Entrar a ${channel.name}`,
          onclick: () => (here ? null : actions().joinVoice(channel)),
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
                  speaking: Boolean(here && call.isSpeaking(p.member_id)),
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

  function serverMenu(anchor) {
    ui.popover(anchor, [
      { label: 'Invitar gente', icon: 'userPlus', onClick: () => actions().showInvite() },
      { label: 'Cambiar mi nombre visible', icon: 'edit', onClick: () => actions().showEditDisplayName() },
      'separator',
      { label: 'Salir del servidor', icon: 'logOut', danger: true, onClick: () => actions().leaveServer() },
    ]);
  }

  // ─── Servidor: chat ───────────────────────────────────────────────────────

  function currentChannel(ss) {
    if (!ss || !ss.detail) return null;
    return ss.detail.channels.find((c) => c.id === ss.channelId) || null;
  }

  function renderServerMain() {
    const main = clear($('main'));
    const session = currentSession();
    const ss = serverState();
    if (!session || !ss) return;

    const channel = currentChannel(ss);

    const header = h(
      'header',
      { class: 'main-header' },
      channel ? icon('hash', 20) : null,
      h('h1', { class: 'main-title' }, channel ? channel.name : session.name),
      channel && channel.topic ? h('span', { class: 'main-topic' }, channel.topic) : null,
      h('div', { class: 'main-header-spacer' }),
      h(
        'button',
        { class: 'icon-btn', title: 'Invitar gente', onclick: () => actions().showInvite() },
        icon('userPlus', 20),
      ),
      h(
        'button',
        {
          class: `icon-btn${R.state.showMembers ? ' is-on' : ''}`,
          title: R.state.showMembers ? 'Ocultar miembros' : 'Mostrar miembros',
          'aria-pressed': String(Boolean(R.state.showMembers)),
          onclick: () => actions().toggleMembers(),
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
    append(main, header, banner, scroller, composer(session, ss, channel));

    renderBanner();
    renderMessages({ forceBottom: true });
  }

  function unreachableNotice(session) {
    return ui.emptyState({
      iconName: 'wifiOff',
      title: 'No se puede conectar',
      text: `${session.baseUrl.replace(/^https?:\/\//, '')} no responde. Puede que su dueño lo haya apagado. Reintentamos solos.`,
    });
  }

  function renderBanner() {
    const el = $('chat-banner');
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
            { class: 'btn btn-sm btn-danger', onclick: () => actions().forgetSession(session.key) },
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
            { class: 'btn btn-sm btn-primary', onclick: () => actions().showRejoin() },
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

  function composer(session, ss, channel) {
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
    textarea.value = R.state.drafts[draftKey] || '';

    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
      const left = MAX_MESSAGE_LENGTH - textarea.value.length;
      counter.hidden = left > 200;
      counter.textContent = String(left);
      counter.classList.toggle('is-low', left < 50);
    };

    textarea.addEventListener('input', () => {
      R.state.drafts[draftKey] = textarea.value;
      resize();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        const content = textarea.value.trim();
        if (!content) return;
        textarea.value = '';
        R.state.drafts[draftKey] = '';
        resize();
        actions().sendMessage(content);
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

  // Redibuja solo la lista de mensajes, sin tocar el campo de texto. Si estabas
  // leyendo más arriba, no te mueve; si estabas abajo, te deja abajo.
  function renderMessages({ forceBottom = false, keepOffsetFrom = null } = {}) {
    const scroller = $('messages');
    const ss = serverState();
    const channel = currentChannel(ss);
    if (!scroller || !channel) return;

    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const thread = ss.messages[channel.id];
    clear(scroller);

    if (!thread || !thread.loaded) {
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
              onclick: () => actions().loadOlder(),
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
    let previous = null;
    for (const message of items) {
      const date = new Date(message.created_at);
      if (!previous || !sameDay(new Date(previous.created_at), date)) {
        append(scroller, h('div', { class: 'day-divider' }, h('span', null, formatDay(message.created_at))));
        previous = null;
      }
      const grouped =
        previous &&
        previous.author_nickname === message.author_nickname &&
        date - new Date(previous.created_at) < GROUP_WINDOW_MS;
      append(scroller, messageRow(message, members, grouped));
      previous = message;
    }

    if (keepOffsetFrom !== null) {
      scroller.scrollTop = scroller.scrollHeight - keepOffsetFrom;
    } else if (forceBottom || nearBottom) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function membersByNick(ss) {
    const map = new Map();
    for (const member of ss.members) map.set(member.nickname, member);
    return map;
  }

  function messageRow(message, members, grouped) {
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
  function linkify(text) {
    const parts = [];
    const pattern = /\bhttps?:\/\/[^\s<>"']+/gi;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(h('a', { href: match[0], target: '_blank', rel: 'noreferrer' }, match[0]));
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  // ─── Servidor: miembros ───────────────────────────────────────────────────

  function renderMembers() {
    const panel = clear($('members'));
    const ss = serverState();
    const session = currentSession();
    if (!R.state.showMembers || !ss || !session) return;

    const groups = [
      ['owner', 'Dueño'],
      ['admin', 'Administradores'],
      ['member', 'Miembros'],
    ];

    const scroll = h('div', { class: 'members-scroll' });
    for (const [role, label] of groups) {
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

  function memberRow(session, ss, member) {
    const isMe = member.nickname === session.member.nickname;
    return h(
      'button',
      {
        class: 'member',
        title: `@${member.nickname}`,
        onclick: (event) => memberMenu(event.currentTarget, session, ss, member, isMe),
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

  function memberMenu(anchor, session, ss, member, isMe) {
    const myRole = myRoleIn(session, ss);
    const canManage =
      !isMe && ROLE_RANK[myRole] >= ROLE_RANK.admin && ROLE_RANK[myRole] > ROLE_RANK[member.role];

    const items = [
      {
        label: `Copiar @${member.nickname}`,
        icon: 'copy',
        onClick: () => ui.copy(`@${member.nickname}`, 'Nickname copiado.'),
      },
    ];
    if (isMe)
      items.push({
        label: 'Cambiar mi nombre visible',
        icon: 'edit',
        onClick: () => actions().showEditDisplayName(),
      });
    if (canManage && myRole === 'owner') {
      items.push(
        member.role === 'admin'
          ? {
              label: 'Quitar administrador',
              icon: 'shield',
              onClick: () => actions().setRole(member, 'member'),
            }
          : {
              label: 'Hacer administrador',
              icon: 'shield',
              onClick: () => actions().setRole(member, 'admin'),
            },
      );
    }
    if (canManage) {
      items.push('separator', {
        label: `Expulsar a ${member.display_name}`,
        icon: 'logOut',
        danger: true,
        onClick: () => actions().kick(member),
      });
    }
    ui.popover(anchor, items, { align: 'end' });
  }

  function myRoleIn(session, ss) {
    const me = ss.members.find((m) => m.nickname === session.member.nickname);
    return (me || session.member).role;
  }

  R.views = {
    renderAll,
    renderRail,
    renderHomeSidebar,
    renderHomeMain,
    renderServerSidebar,
    renderServerMain,
    renderMessages,
    renderMembers,
    renderBanner,
    currentSession,
    serverState,
    currentChannel,
    myRoleIn,
  };
})(window.Recop);
