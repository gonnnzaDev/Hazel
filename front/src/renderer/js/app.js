// Estado de la app, acciones y sondeo periódico.
//
// El backend todavía no tiene WebSocket de chat, así que los mensajes, los
// miembros y quién está en cada canal de voz se piden cada pocos segundos.
// Cuando exista `WS /api/v1/ws`, el sondeo de mensajes se reemplaza por los
// eventos `message.created` sin tocar las vistas.

(function (R) {
  'use strict';

  const { api, store, ui, views } = R;
  const { h, normalizeNickname, normalizeSlug } = R.util;

  const POLL_MS = 2500;
  const MESSAGE_PAGE = 50;

  const state = {
    view: 'home', // home | server
    sessionKey: null,
    showMembers: true,
    drafts: {},
    node: { status: 'loading', info: null, address: null, servers: [], busy: {} },
    servers: {}, // sessionKey → estado del servidor abierto
    call: null, // VoiceCall activo
  };
  R.state = state;

  const inFlight = new Set();

  // Evita pedir lo mismo dos veces a la vez cuando un servidor tarda.
  async function once(key, fn) {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      await fn();
    } finally {
      inFlight.delete(key);
    }
  }

  function serverStateFor(key) {
    if (!state.servers[key]) {
      state.servers[key] = {
        detail: null,
        members: [],
        channelId: null,
        messages: {},
        voice: {},
        reachable: true,
        sessionExpired: false,
        gone: false,
      };
    }
    return state.servers[key];
  }

  function isOpen(key) {
    return state.view === 'server' && state.sessionKey === key;
  }

  function nodeUrl() {
    return store.getSettings().nodeUrl;
  }

  // ─── Tema ─────────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  // ─── Navegación ───────────────────────────────────────────────────────────

  function openHome() {
    state.view = 'home';
    state.sessionKey = null;
    store.updateSettings({ lastView: 'home' });
    views.renderAll();
    refreshNode();
  }

  function openSession(key) {
    const session = store.getSession(key);
    if (!session) return openHome();

    state.view = 'server';
    state.sessionKey = key;
    store.updateSettings({ lastView: key });

    const ss = serverStateFor(key);
    if (!ss.channelId && session.lastChannelId) ss.channelId = session.lastChannelId;
    pickChannel(ss);

    views.renderAll();
    loadServer(key);
  }

  async function loadServer(key) {
    await refreshDetail(key);
    await Promise.all([refreshMembers(key), refreshMessages(key), refreshVoice(key), checkToken(key)]);
  }

  function selectChannel(channelId) {
    const key = state.sessionKey;
    const ss = serverStateFor(key);
    if (ss.channelId === channelId) return;
    ss.channelId = channelId;
    const session = store.getSession(key);
    if (session) store.saveSession({ ...session, lastChannelId: channelId });
    views.renderServerSidebar();
    views.renderServerMain();
    refreshMessages(key);
  }

  function toggleMembers() {
    state.showMembers = !state.showMembers;
    views.renderAll();
  }

  // ─── Nodo ─────────────────────────────────────────────────────────────────

  function nodeSignature(node) {
    return JSON.stringify([
      node.status,
      node.info && node.info.version,
      node.address && node.address.recommended,
      node.servers.map((s) => [s.id, s.name, s.status, s.bind_port]),
      node.busy,
    ]);
  }

  async function refreshNode({ announce = false } = {}) {
    await once('node', async () => {
      const before = nodeSignature(state.node);
      const base = nodeUrl();
      try {
        const [info, list] = await Promise.all([api.nodeInfo(base), api.listServers(base)]);
        const address = state.node.address || (await api.nodeAddress(base).catch(() => null));
        state.node = { ...state.node, status: 'online', info, address, servers: list.items };
      } catch (error) {
        state.node = { ...state.node, status: 'offline', info: null, address: null, servers: [] };
        if (announce) ui.toast(error.message, { kind: 'error' });
      }
      if (state.view === 'home' && nodeSignature(state.node) !== before) {
        views.renderHomeSidebar();
        views.renderHomeMain();
      }
    });
  }

  function bracket(host) {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  }

  function isLoopback(host) {
    return host === 'localhost' || host.startsWith('127.') || host === '[::1]' || host === '::1';
  }

  // La dirección que el dueño le pasa a sus amigos: ip-de-la-red:puerto/slug.
  // 127.0.0.1 no sirve para nadie más, así que se cambia por la IP que el
  // nodo recomienda.
  function shareableHost(host) {
    const recommended = state.node.address && state.node.address.recommended;
    return isLoopback(host) && recommended ? recommended : host;
  }

  function inviteAddressFor(server) {
    const host = shareableHost(new URL(nodeUrl()).hostname);
    return `${bracket(host)}:${server.bind_port}/${server.slug}`;
  }

  async function withBusy(server, kind, fn) {
    state.node.busy = { ...state.node.busy, [server.id]: kind };
    views.renderHomeMain();
    try {
      await fn();
    } catch (error) {
      ui.toast(error.message, { kind: 'error' });
    } finally {
      const busy = { ...state.node.busy };
      delete busy[server.id];
      state.node.busy = busy;
      await refreshNode();
      if (state.view === 'home') views.renderHomeMain();
    }
  }

  function startServer(server) {
    return withBusy(server, 'start', async () => {
      const updated = await api.activateServer(nodeUrl(), server.id);
      if (updated.status === 'active') ui.toast(`${server.name} está encendido.`, { kind: 'success' });
      else ui.toast(`${server.name} no pudo arrancar. Mirá el log del nodo.`, { kind: 'error' });
    });
  }

  async function stopServer(server) {
    const ok = await ui.confirmDialog({
      title: `¿Apagar ${server.name}?`,
      message:
        'La gente que esté conectada se va a desconectar. No se borra nada: cuando lo vuelvas a encender, está todo como estaba.',
      confirmLabel: 'Apagar',
    });
    if (!ok) return;
    return withBusy(server, 'stop', async () => {
      await api.deactivateServer(nodeUrl(), server.id);
      ui.toast(`${server.name} está apagado.`);
    });
  }

  async function deleteServer(server) {
    const ok = await ui.confirmDialog({
      title: `¿Eliminar ${server.name}?`,
      message:
        'Se borran para siempre sus canales, miembros y mensajes. Esto no se puede deshacer. Si solo querés que nadie entre, apagalo.',
      confirmLabel: 'Eliminar para siempre',
      danger: true,
    });
    if (!ok) return;
    return withBusy(server, 'delete', async () => {
      await api.deleteServer(nodeUrl(), server.id);
      for (const session of store.listSessions().filter((s) => s.serverId === server.id)) {
        endCallIn(session);
        store.removeSession(session.key);
        delete state.servers[session.key];
      }
      views.renderRail();
      ui.toast(`${server.name} fue eliminado.`);
    });
  }

  // "Abrir" en el panel del nodo: si ya entraste, va directo; si no, entrás
  // con un nickname. El primero que entra a un servidor es su dueño.
  function openOwnedServer(server) {
    const existing = store.findSessionByServerId(server.id);
    if (existing) return openSession(existing.key);
    showJoinKnown({ baseUrl: api.groupUrlFromNode(nodeUrl(), server.bind_port), server });
  }

  // ─── Entrar a un servidor ─────────────────────────────────────────────────

  async function resolveServer(baseUrl, port, slug) {
    if (slug) return api.getServerBySlug(baseUrl, slug);

    // Sin slug: el proceso del grupo conoce a los servidores del nodo, y el que
    // escucha en este puerto es el que buscamos.
    const list = await api.listServers(baseUrl);
    const byPort = list.items.find((s) => s.bind_port === port);
    if (byPort) return byPort;
    const active = list.items.filter((s) => s.status === 'active');
    if (active.length === 1) return active[0];
    throw new Error(
      'No encontramos el servidor en esa dirección. Pedí la dirección completa, con el nombre al final (ip:puerto/nombre).',
    );
  }

  async function joinWith({ baseUrl, server, nickname, displayName }) {
    if (server.status && server.status !== 'active') {
      throw new Error(`${server.name} está apagado. Pedile a su dueño que lo encienda.`);
    }

    const response = await api.join(baseUrl, server.id, {
      nickname,
      display_name: displayName || undefined,
    });

    const key = store.sessionKey(baseUrl, server.id);
    const previous = store.getSession(key);
    store.saveSession({
      key,
      baseUrl,
      serverId: server.id,
      name: server.name,
      slug: server.slug,
      token: response.token,
      expiresAt: response.expires_at,
      member: response.member,
      lastChannelId: previous ? previous.lastChannelId : null,
    });
    store.updateSettings({ lastNickname: response.member.nickname });

    const ss = serverStateFor(key);
    ss.sessionExpired = false;
    ss.gone = false;
    if (server.channels) ss.detail = server;

    openSession(key);
    return response;
  }

  // Lo que la persona escribió en "Tu nickname". El backend lo normaliza
  // ("Ana Paula" → @ana_paula); si cambia, lo escrito queda como nombre visible
  // para que en el chat se vea "Ana Paula" y no "Ana_paula".
  function namesFrom(raw) {
    const typed = String(raw || '').trim();
    const normalized = normalizeNickname(typed);
    return {
      nickname: typed,
      displayName: typed && normalized !== typed ? typed.slice(0, 64) : undefined,
    };
  }

  function nicknameField(value) {
    const preview = h(
      'span',
      { class: 'field-hint' },
      '2 a 32 caracteres: letras, números, punto, guion y guion bajo.',
    );
    const control = ui.input({
      name: 'nickname',
      required: true,
      maxlength: 32,
      value: value || '',
      placeholder: 'ej: ana',
    });
    const update = () => {
      const normalized = normalizeNickname(control.value);
      preview.textContent =
        control.value && normalized !== control.value
          ? `Vas a entrar como @${normalized || '…'}`
          : '2 a 32 caracteres: letras, números, punto, guion y guion bajo.';
    };
    control.addEventListener('input', update);
    update();
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Tu nickname'),
      control,
      preview,
    );
  }

  function showJoin() {
    const settings = store.getSettings();
    ui.formModal({
      title: 'Unirse a un servidor',
      subtitle: 'Sin cuenta ni contraseña: solo la dirección y un nombre.',
      submitLabel: 'Entrar',
      fields: [
        ui.field(
          'Dirección',
          ui.input({ name: 'address', required: true, placeholder: '192.168.1.50:7273/casa-de-luis' }),
          'Pedísela a quien armó el servidor.',
        ),
        nicknameField(settings.lastNickname),
      ],
      onSubmit: async (data, modal) => {
        const target = api.parseAddress(data.get('address'));
        const names = namesFrom(data.get('nickname'));
        const server = await resolveServer(target.baseUrl, target.port, target.slug);
        const response = await joinWith({ baseUrl: target.baseUrl, server, ...names });
        modal.close();
        ui.toast(`Entraste a ${server.name} como @${response.member.nickname}.`, { kind: 'success' });
      },
    });
  }

  function showJoinKnown({ baseUrl, server, title, subtitle, nickname }) {
    ui.formModal({
      title: title || `Entrar a ${server.name}`,
      subtitle: subtitle || 'Elegí con qué nombre te ven. Si sos el primero en entrar, quedás como dueño.',
      submitLabel: 'Entrar',
      fields: [nicknameField(nickname || store.getSettings().lastNickname)],
      onSubmit: async (data, modal) => {
        await joinWith({ baseUrl, server, ...namesFrom(data.get('nickname')) });
        modal.close();
      },
    });
  }

  async function showRejoin() {
    const session = views.currentSession();
    if (!session) return;
    const ss = serverStateFor(session.key);
    let server = ss.detail;
    if (!server) {
      try {
        server = await api.getServer(session.baseUrl, session.serverId);
      } catch (error) {
        ui.toast(error.message, { kind: 'error' });
        return;
      }
    }
    showJoinKnown({
      baseUrl: session.baseUrl,
      server,
      title: 'Volver a entrar',
      subtitle: 'Entrando con el mismo nickname recuperás tu lugar: no hace falta contraseña.',
      nickname: session.member.nickname,
    });
  }

  function showAddServer() {
    const option = (iconName, title, text, onClick) =>
      h(
        'button',
        { class: 'choice', onclick: onClick },
        h('span', { class: 'choice-icon' }, R.icons.icon(iconName, 22)),
        h('span', { class: 'choice-text' }, h('strong', null, title), h('small', null, text)),
      );

    ui.modal({
      title: 'Agregar un servidor',
      subtitle: 'Armá el tuyo o entrá al de alguien más.',
      body: h(
        'div',
        { class: 'choices' },
        option('server', 'Crear mi servidor', 'Corre en tu compu. Vos decidís cuándo está encendido.', () => {
          ui.closeModal();
          showCreateServer();
        }),
        option('logIn', 'Unirme a un servidor', 'Con la dirección que te pasaron.', () => {
          ui.closeModal();
          showJoin();
        }),
      ),
    });
  }

  // ─── Crear un servidor ────────────────────────────────────────────────────

  function showCreateServer() {
    if (state.node.status !== 'online') {
      openHome();
      ui.toast('Para crear un servidor tiene que estar encendido tu nodo.', { kind: 'error' });
      return;
    }

    const name = ui.input({ name: 'name', required: true, maxlength: 64, placeholder: 'Casa de Luis' });
    const slug = ui.input({ name: 'slug', maxlength: 64, placeholder: 'casa-de-luis' });
    let slugTouched = false;
    name.addEventListener('input', () => {
      if (!slugTouched) slug.value = normalizeSlug(name.value);
    });
    slug.addEventListener('input', () => {
      slugTouched = true;
    });

    const voice = h('input', { type: 'checkbox', name: 'voice', checked: true });

    ui.formModal({
      title: 'Crear un servidor',
      subtitle: 'Va a correr en esta compu y le vas a pasar la dirección a tus amigos.',
      submitLabel: 'Crear servidor',
      fields: [
        ui.field('Nombre', name),
        ui.field(
          'Identificador',
          slug,
          'Va al final de la dirección que compartís. Solo letras, números y guiones.',
        ),
        nicknameField(store.getSettings().lastNickname),
        h('label', { class: 'check' }, voice, h('span', null, 'Agregar un canal de voz')),
      ],
      onSubmit: async (data, modal) => {
        const serverName = String(data.get('name') || '').trim();
        const serverSlug = normalizeSlug(data.get('slug') || serverName);
        const names = namesFrom(data.get('nickname'));
        if (serverName.length < 2) throw new Error('El nombre tiene que tener al menos 2 caracteres.');
        if (serverSlug.length < 2)
          throw new Error('El identificador tiene que tener al menos 2 letras o números.');

        const channels = [{ name: 'general', kind: 'text', is_default: true, position: 0 }];
        if (data.get('voice')) channels.push({ name: 'charla', kind: 'voice', position: 1 });

        const server = await api.createServer(nodeUrl(), {
          name: serverName,
          slug: serverSlug,
          owner_nickname: names.nickname,
          channels,
        });
        modal.close();
        await refreshNode();

        if (server.status !== 'active') {
          ui.toast(`${server.name} se creó, pero no arrancó. Probá encenderlo desde Mis servidores.`, {
            kind: 'error',
            timeout: 6000,
          });
          return;
        }

        try {
          await joinWith({ baseUrl: api.groupUrlFromNode(nodeUrl(), server.bind_port), server, ...names });
          ui.toast(`${server.name} está listo. Invitá a tus amigos con su dirección.`, { kind: 'success' });
        } catch (error) {
          ui.toast(`${server.name} se creó, pero no pudimos entrar: ${error.message}`, {
            kind: 'error',
            timeout: 6000,
          });
        }
      },
    });
  }

  // ─── Datos del servidor abierto ───────────────────────────────────────────

  // Un error de red marca el servidor como inalcanzable; un 401, la sesión como
  // vencida; un 404 del servidor, que lo borraron. Cualquier otra cosa se avisa.
  function noteFailure(key, error, { quiet = true } = {}) {
    const ss = serverStateFor(key);
    if (error.isNetwork) {
      if (ss.reachable) {
        ss.reachable = false;
        repaintStatus(key);
      }
    } else if (error.status === 401) {
      if (!ss.sessionExpired) {
        ss.sessionExpired = true;
        repaintStatus(key);
      }
    } else if (error.code === 'server_not_found') {
      if (!ss.gone) {
        ss.gone = true;
        repaintStatus(key);
      }
    } else if (!quiet) {
      ui.toast(error.message, { kind: 'error' });
    }
  }

  function noteSuccess(key) {
    const ss = serverStateFor(key);
    if (!ss.reachable) {
      ss.reachable = true;
      repaintStatus(key);
    }
  }

  function repaintStatus(key) {
    views.renderRail();
    if (isOpen(key)) views.renderBanner();
  }

  // Si el canal abierto ya no existe (o todavía no hay uno), cae en el canal
  // por defecto del servidor. Devuelve si cambió.
  function pickChannel(ss) {
    if (!ss.detail) return false;
    const textChannels = ss.detail.channels.filter((c) => c.kind === 'text');
    if (textChannels.some((c) => c.id === ss.channelId)) return false;
    const fallback = textChannels.find((c) => c.is_default) || textChannels[0];
    ss.channelId = fallback ? fallback.id : null;
    return true;
  }

  async function refreshDetail(key) {
    const session = store.getSession(key);
    if (!session) return;
    await once(`detail:${key}`, async () => {
      const ss = serverStateFor(key);
      try {
        const detail = await api.getServer(session.baseUrl, session.serverId);
        const before = JSON.stringify(ss.detail);
        ss.detail = detail;
        noteSuccess(key);

        if (detail.name !== session.name) store.saveSession({ ...session, name: detail.name });

        const channelChanged = pickChannel(ss);

        if (isOpen(key) && (channelChanged || JSON.stringify(detail) !== before)) {
          views.renderRail();
          views.renderServerSidebar();
          views.renderServerMain();
        }
      } catch (error) {
        noteFailure(key, error);
        if (isOpen(key) && !ss.detail) views.renderAll();
      }
    });
  }

  async function checkToken(key) {
    const session = store.getSession(key);
    if (!session) return;
    try {
      const me = await api.me(session.baseUrl, session.token);
      store.saveSession({ ...store.getSession(key), member: me.member });
    } catch (error) {
      noteFailure(key, error);
    }
  }

  async function refreshMembers(key) {
    const session = store.getSession(key);
    if (!session) return;
    await once(`members:${key}`, async () => {
      const ss = serverStateFor(key);
      try {
        const data = await api.members(session.baseUrl, session.serverId);
        const before = JSON.stringify(ss.members);
        ss.members = data.items;
        noteSuccess(key);

        const me = data.items.find((m) => m.nickname === session.member.nickname);
        if (me && JSON.stringify(me) !== JSON.stringify(session.member)) {
          store.saveSession({ ...store.getSession(key), member: me });
        }

        if (isOpen(key) && JSON.stringify(ss.members) !== before) {
          views.renderMembers();
          views.renderMessages(); // los nombres visibles salen de acá
        }
      } catch (error) {
        noteFailure(key, error);
      }
    });
  }

  function threadFor(ss, channelId) {
    if (!ss.messages[channelId]) {
      ss.messages[channelId] = { items: [], total: 0, loaded: false, loadingOlder: false };
    }
    return ss.messages[channelId];
  }

  function byDate(a, b) {
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
  }

  // Junta lo que ya había con lo que llegó, sin duplicados y en orden. Los
  // mensajes que todavía se están enviando quedan al final.
  function merge(thread, incoming) {
    const byId = new Map(thread.items.filter((m) => !m.pending).map((m) => [m.id, m]));
    for (const message of incoming) byId.set(message.id, message);
    const pending = thread.items.filter((m) => m.pending);
    thread.items = [...[...byId.values()].sort(byDate), ...pending];
  }

  function threadSignature(thread) {
    const last = thread.items[thread.items.length - 1];
    return `${thread.loaded}|${thread.total}|${thread.items.length}|${last ? last.id : ''}`;
  }

  async function refreshMessages(key) {
    const session = store.getSession(key);
    const ss = serverStateFor(key);
    const channelId = ss.channelId;
    if (!session || !channelId) return;

    await once(`messages:${key}:${channelId}`, async () => {
      const thread = threadFor(ss, channelId);
      const before = threadSignature(thread);
      try {
        const data = await api.messages(session.baseUrl, session.serverId, channelId, {
          limit: MESSAGE_PAGE,
        });
        merge(thread, data.items);
        thread.total = data.total;
        thread.loaded = true;
        noteSuccess(key);
      } catch (error) {
        noteFailure(key, error);
        return;
      }
      // Alguien nuevo escribió: se piden los miembros ya, para mostrar su
      // nombre visible en vez del nickname. Una sola vez por cada desconocido:
      // quien se fue del servidor no va a aparecer nunca en la lista.
      const known = new Set(ss.members.map((m) => m.nickname));
      const unknown = [
        ...new Set(
          thread.items
            .filter((m) => !m.pending && !known.has(m.author_nickname))
            .map((m) => m.author_nickname),
        ),
      ]
        .sort()
        .join(',');
      if (unknown && unknown !== ss.unknownAuthors) {
        ss.unknownAuthors = unknown;
        refreshMembers(key);
      }
      if (isOpen(key) && ss.channelId === channelId && threadSignature(thread) !== before) {
        views.renderMessages();
      }
    });
  }

  async function loadOlder() {
    const key = state.sessionKey;
    const session = store.getSession(key);
    const ss = serverStateFor(key);
    const channelId = ss.channelId;
    const thread = threadFor(ss, channelId);
    if (thread.loadingOlder) return;

    thread.loadingOlder = true;
    views.renderMessages();
    const scroller = document.getElementById('messages');
    const fromBottom = scroller ? scroller.scrollHeight - scroller.scrollTop : null;
    try {
      const offset = thread.items.filter((m) => !m.pending).length;
      const data = await api.messages(session.baseUrl, session.serverId, channelId, {
        limit: MESSAGE_PAGE,
        offset,
      });
      merge(thread, data.items);
      thread.total = data.total;
    } catch (error) {
      ui.toast(error.message, { kind: 'error' });
    } finally {
      thread.loadingOlder = false;
      if (isOpen(key) && ss.channelId === channelId) views.renderMessages({ keepOffsetFrom: fromBottom });
    }
  }

  async function sendMessage(content) {
    const key = state.sessionKey;
    const session = store.getSession(key);
    const ss = serverStateFor(key);
    const channelId = ss.channelId;
    if (!session || !channelId) return;

    const thread = threadFor(ss, channelId);
    const pending = {
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author_nickname: session.member.nickname,
      content,
      created_at: new Date().toISOString(),
      pending: true,
    };
    thread.items.push(pending);
    views.renderMessages({ forceBottom: true });

    try {
      const message = await api.sendMessage(
        session.baseUrl,
        session.serverId,
        channelId,
        session.token,
        content,
      );
      thread.items = thread.items.filter((m) => m !== pending);
      merge(thread, [message]);
      thread.total += 1;
      noteSuccess(key);
    } catch (error) {
      thread.items = thread.items.filter((m) => m !== pending);
      noteFailure(key, error, { quiet: false });
      if (error.isNetwork) ui.toast('No se pudo enviar: el servidor no responde.', { kind: 'error' });
      if (error.status === 401) ui.toast('No se pudo enviar: tu sesión venció.', { kind: 'error' });
      restoreDraft(content);
    }
    if (isOpen(key) && ss.channelId === channelId) views.renderMessages({ forceBottom: true });
  }

  // Si un mensaje no salió, vuelve al campo de texto para no perderlo.
  function restoreDraft(content) {
    const composer = document.getElementById('composer');
    if (composer && !composer.value) {
      composer.value = content;
      composer.dispatchEvent(new Event('input'));
    }
  }

  // ─── Voz ──────────────────────────────────────────────────────────────────

  async function refreshVoice(key) {
    const session = store.getSession(key);
    const ss = serverStateFor(key);
    if (!session || !ss.detail || ss.sessionExpired) return;
    const voiceChannels = ss.detail.channels.filter((c) => c.kind === 'voice');
    if (!voiceChannels.length) return;

    await once(`voice:${key}`, async () => {
      const before = JSON.stringify(ss.voice);
      try {
        const results = await Promise.all(
          voiceChannels.map((c) =>
            api.callParticipants(session.baseUrl, session.serverId, c.id, session.token),
          ),
        );
        ss.voice = Object.fromEntries(results.map((r) => [r.channel_id, r.participants]));
      } catch (error) {
        noteFailure(key, error);
        return;
      }
      if (isOpen(key) && JSON.stringify(ss.voice) !== before) views.renderServerSidebar();
    });
  }

  function repaintCall() {
    if (state.view === 'server') views.renderServerSidebar();
    else views.renderHomeSidebar();
    views.renderRail();
  }

  // El indicador de quién habla cambia varias veces por segundo: se actualiza
  // en el lugar para no redibujar la lista bajo el mouse.
  function paintSpeaking(call) {
    for (const el of document.querySelectorAll('[data-speaker]')) {
      el.classList.toggle('is-speaking', call.isSpeaking(el.dataset.speaker));
    }
  }

  async function joinVoice(channel) {
    const session = views.currentSession();
    if (!session) return;

    if (state.call) {
      state.call.end(null, { silent: true });
      state.call = null;
    }

    const call = new R.VoiceCall({
      baseUrl: session.baseUrl,
      serverId: session.serverId,
      channelId: channel.id,
      channelName: channel.name,
      serverName: session.name,
      token: session.token,
      self: session.member,
      onChange: (c, kind) => {
        if (state.call !== c) return;
        if (kind === 'speaking') paintSpeaking(c);
        else repaintCall();
      },
      onEnd: (c, reason) => {
        if (state.call === c) state.call = null;
        if (reason) ui.toast(reason, { kind: 'error' });
        repaintCall();
        refreshVoice(session.key);
      },
    });

    state.call = call;
    repaintCall();
    try {
      await call.start();
    } catch (error) {
      if (state.call === call) state.call = null;
      if (error.code === 'invalid_token' || error.code === 'missing_token') {
        noteFailure(session.key, { status: 401 });
      }
      ui.toast(error.message, { kind: 'error' });
    }
    repaintCall();
  }

  function leaveCall() {
    if (!state.call) return;
    const call = state.call;
    state.call = null;
    call.end(null, { silent: true });
    repaintCall();
    if (state.sessionKey) refreshVoice(state.sessionKey);
  }

  function endCallIn(session) {
    if (state.call && state.call.baseUrl === session.baseUrl && state.call.serverId === session.serverId)
      leaveCall();
  }

  // ─── Miembros ─────────────────────────────────────────────────────────────

  async function setRole(member, role) {
    const session = views.currentSession();
    try {
      await api.setRole(session.baseUrl, session.serverId, session.token, member.nickname, role);
      ui.toast(
        role === 'admin'
          ? `${member.display_name} ahora es administrador.`
          : `${member.display_name} ya no es administrador.`,
        {
          kind: 'success',
        },
      );
      await refreshMembers(session.key);
    } catch (error) {
      noteFailure(session.key, error, { quiet: false });
    }
  }

  async function kick(member) {
    const session = views.currentSession();
    const ok = await ui.confirmDialog({
      title: `¿Expulsar a ${member.display_name}?`,
      message: `@${member.nickname} sale del servidor. Puede volver a entrar si tiene la dirección.`,
      confirmLabel: 'Expulsar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.kick(session.baseUrl, session.serverId, session.token, member.nickname);
      ui.toast(`${member.display_name} fue expulsado.`);
      await refreshMembers(session.key);
    } catch (error) {
      noteFailure(session.key, error, { quiet: false });
    }
  }

  function showEditDisplayName() {
    const session = views.currentSession();
    if (!session) return;
    ui.formModal({
      title: 'Tu nombre visible',
      subtitle: `Es como te ven en ${session.name}. Tu nickname (@${session.member.nickname}) no cambia.`,
      submitLabel: 'Guardar',
      fields: [
        ui.field(
          'Nombre visible',
          ui.input({
            name: 'display_name',
            required: true,
            maxlength: 64,
            value: session.member.display_name,
          }),
        ),
      ],
      onSubmit: async (data, modal) => {
        const member = await api.updateMe(
          session.baseUrl,
          session.token,
          String(data.get('display_name') || '').trim(),
        );
        store.saveSession({ ...store.getSession(session.key), member });
        modal.close();
        ui.toast('Listo, cambiaste tu nombre.', { kind: 'success' });
        await refreshMembers(session.key);
        views.renderServerSidebar();
      },
    });
  }

  // ─── Invitar y salir ──────────────────────────────────────────────────────

  function showInvite() {
    const session = views.currentSession();
    if (!session) return;
    const url = new URL(session.baseUrl);
    const host = shareableHost(url.hostname);
    const address = `${bracket(host)}:${url.port}/${session.slug}`;
    const onlyHere = isLoopback(host);

    const box = ui.input({ value: address, readonly: true, 'aria-label': 'Dirección del servidor' });
    box.addEventListener('focus', () => box.select());

    ui.modal({
      title: `Invitar gente a ${session.name}`,
      subtitle: 'Pasales esta dirección. Entran con un nickname, sin cuenta.',
      body: h(
        'div',
        { class: 'form' },
        h(
          'div',
          { class: 'copy-row' },
          box,
          h(
            'button',
            { class: 'btn btn-primary', onclick: () => ui.copy(address, 'Dirección copiada.') },
            R.icons.icon('copy', 16),
            'Copiar',
          ),
        ),
        h(
          'p',
          { class: 'field-hint' },
          onlyHere
            ? '127.0.0.1 solo sirve en esta compu. Para tus amigos, cambialo por la IP de tu compu en la red (la ves con ipconfig o ip addr).'
            : 'Tienen que estar en tu misma red, o poder llegar a ese puerto de tu compu.',
        ),
      ),
    });
  }

  async function leaveServer() {
    const session = views.currentSession();
    if (!session) return;
    const ok = await ui.confirmDialog({
      title: `¿Salir de ${session.name}?`,
      message:
        'Dejás de ser miembro. Si eras el dueño, el rol pasa al miembro más antiguo. Podés volver a entrar con la dirección.',
      confirmLabel: 'Salir del servidor',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.leave(session.baseUrl, session.serverId, session.token);
    } catch (error) {
      if (error.status !== 401 && error.code !== 'server_not_found') {
        const forget = await ui.confirmDialog({
          title: 'No pudimos avisarle al servidor',
          message: `${error.message} ¿Lo quitamos de tu lista igual?`,
          confirmLabel: 'Quitar de mi lista',
          danger: true,
        });
        if (!forget) return;
      }
    }
    forgetSession(session.key);
  }

  function forgetSession(key) {
    const session = store.getSession(key);
    if (session) endCallIn(session);
    store.removeSession(key);
    delete state.servers[key];
    openHome();
  }

  // ─── Configuración ────────────────────────────────────────────────────────

  function showSettings() {
    const settings = store.getSettings();
    const themes = [
      ['system', 'Como el sistema'],
      ['light', 'Claro'],
      ['dark', 'Oscuro'],
    ];
    const themeGroup = h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': 'Tema' },
      themes.map(([value, label]) =>
        h(
          'label',
          { class: 'segmented-option' },
          h('input', { type: 'radio', name: 'theme', value, checked: settings.theme === value }),
          h('span', null, label),
        ),
      ),
    );
    themeGroup.addEventListener('change', (event) => applyTheme(event.target.value));

    ui.formModal({
      title: 'Configuración',
      submitLabel: 'Guardar',
      fields: [
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tema'), themeGroup),
        ui.field(
          'Dirección de tu nodo',
          ui.input({
            name: 'nodeUrl',
            required: true,
            value: settings.nodeUrl,
            placeholder: 'http://127.0.0.1:7272',
          }),
          'Donde corre tu nodo. Si lo arrancaste en esta compu, dejalo como está.',
        ),
      ],
      // Cerrar sin guardar devuelve el tema que había; guardando, ya es el nuevo.
      onClose: () => applyTheme(store.getSettings().theme),
      onSubmit: async (data, modal) => {
        let url = String(data.get('nodeUrl') || '').trim();
        if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error('Esa dirección no es válida. Ejemplo: http://127.0.0.1:7272');
        }
        const nodeChanged = parsed.origin !== new URL(settings.nodeUrl).origin;
        store.updateSettings({ theme: data.get('theme'), nodeUrl: parsed.origin });
        applyTheme(data.get('theme'));
        modal.close();
        if (nodeChanged) {
          state.node = { status: 'loading', info: null, address: null, servers: [], busy: {} };
          views.renderAll();
          await refreshNode({ announce: true });
        }
      },
    });
  }

  // ─── Arranque ─────────────────────────────────────────────────────────────

  let tick = 0;

  function poll() {
    if (document.hidden) return;
    tick += 1;
    if (state.view === 'home') {
      if (tick % 2 === 0) refreshNode();
      return;
    }
    const key = state.sessionKey;
    if (!key) return;
    refreshMessages(key);
    if (tick % 2 === 0) refreshVoice(key);
    if (tick % 4 === 0) refreshMembers(key);
    if (tick % 8 === 0) refreshDetail(key);
    if (tick % 12 === 0) refreshNode();
  }

  function boot() {
    const settings = store.getSettings();
    applyTheme(settings.theme);

    if (settings.lastView && settings.lastView !== 'home' && store.getSession(settings.lastView)) {
      openSession(settings.lastView);
    } else {
      state.view = 'home';
      views.renderAll();
    }
    refreshNode();

    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        tick = 0;
        poll();
        if (state.view === 'server' && state.sessionKey) loadServer(state.sessionKey);
      }
    });
    window.addEventListener('beforeunload', () => {
      if (state.call) state.call.end(null, { silent: true });
    });
  }

  R.actions = {
    openHome,
    openSession,
    selectChannel,
    toggleMembers,
    refreshNode,
    inviteAddressFor,
    startServer,
    stopServer,
    deleteServer,
    openOwnedServer,
    showJoin,
    showRejoin,
    showAddServer,
    showCreateServer,
    sendMessage,
    loadOlder,
    joinVoice,
    leaveCall,
    setRole,
    kick,
    showEditDisplayName,
    showInvite,
    leaveServer,
    forgetSession,
    showSettings,
    paintSpeaking,
  };

  boot();
})(window.Recop);
