// Paleta de comandos estilo Wofi/Rofi (Ctrl+K): búsqueda difusa sobre
// acciones, servidores, canales y gente. Todo sale de los datos reales.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  copyAddress,
  currentKey,
  goHome,
  leaveVoice,
  openOwnServer,
  openVoice,
  selectChannel,
  selectDm,
  selectSession,
  toggleDeafen,
  toggleMute,
} from '../actions';
import { accentOf } from '../lib/color';
import { fuzzyFilter } from '../lib/fuzzy';
import { openModal, useApp } from '../store/app';
import { sessionKey, useSessions } from '../store/sessions';
import { useSettings } from '../store/settings';
import { useVoice } from '../store/voice';
import { Avatar, Icon, type IconName } from './ui';

type Section = 'acciones' | 'servidores' | 'canales' | 'personas';
const SECTIONS: Section[] = ['acciones', 'servidores', 'canales', 'personas'];

interface Item {
  id: string;
  section: Section;
  title: string;
  /** Con qué se compara la búsqueda, si no es el título. */
  match?: string;
  subtitle?: string;
  icon?: IconName;
  accent?: string;
  person?: { name: string; nick: string };
  run: () => void;
}

export function Wofi() {
  const open = useApp((s) => s.wofiOpen);
  if (!open) return null;
  return <Palette />;
}

function close() {
  useApp.setState({ wofiOpen: false });
}

function Palette() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const sessions = useSessions((s) => s.sessions);
  const servers = useApp((s) => s.servers);
  const members = useApp((s) => s.members);
  const nodeServers = useApp((s) => s.node.servers);
  const view = useApp((s) => s.view);
  const call = useVoice((s) => s.call);
  const nodeUrl = useSettings((s) => s.nodeUrl);

  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const key = currentKey(view);
    const actions: Item[] = [
      { id: 'a-home', section: 'acciones', title: 'Ir a mi nodo', subtitle: 'tus servidores y widgets', icon: 'home', run: goHome },
      { id: 'a-create', section: 'acciones', title: 'Crear un servidor', icon: 'plus-square', run: () => openModal({ kind: 'create' }) },
      { id: 'a-join', section: 'acciones', title: 'Unirme a un servidor', subtitle: 'con la dirección que te pasaron', icon: 'log-in', run: () => openModal({ kind: 'join' }) },
      { id: 'a-status', section: 'acciones', title: 'Cambiar mi estado', icon: 'smile', run: () => openModal({ kind: 'status', key: key ?? undefined }) },
      { id: 'a-settings', section: 'acciones', title: 'Ajustes', icon: 'sliders', run: () => openModal({ kind: 'settings' }) },
      {
        id: 'a-mentions',
        section: 'acciones',
        title: 'Ver menciones y mensajes directos',
        icon: 'at-sign',
        run: () => useApp.setState({ mentionsOpen: true }),
      },
    ];
    if (key) {
      const session = sessions.find((s) => s.key === key);
      const server = servers[key];
      if (session && server) {
        actions.push({
          id: 'a-copy',
          section: 'acciones',
          title: `Copiar la dirección de ${session.name}`,
          subtitle: 'para invitar gente',
          icon: 'link',
          run: () => void copyAddress(session.baseUrl, server),
        });
      }
    }
    if (call) {
      actions.push(
        { id: 'a-mute', section: 'acciones', title: call.muted ? 'Activar micrófono' : 'Silenciar micrófono', icon: call.muted ? 'mic' : 'mic-off', run: toggleMute },
        { id: 'a-deafen', section: 'acciones', title: call.deafened ? 'Volver a escuchar' : 'Ensordecer', icon: 'headphones', run: toggleDeafen },
        { id: 'a-leave', section: 'acciones', title: `Salir de ${call.channelName}`, icon: 'phone-off', run: leaveVoice },
      );
    }

    const serverItems: Item[] = sessions.map((session) => ({
      id: `s-${session.key}`,
      section: 'servidores',
      title: session.name,
      subtitle: `@${session.member.nickname} · ${new URL(session.baseUrl).host}`,
      accent: accentOf(session.serverId),
      icon: 'server',
      run: () => selectSession(session.key),
    }));
    for (const server of nodeServers) {
      if (sessions.some((s) => s.key === sessionKey(nodeUrl, server.id))) continue;
      serverItems.push({
        id: `n-${server.id}`,
        section: 'servidores',
        title: server.name,
        subtitle: `tu nodo · ${server.status === 'active' ? 'encendido' : 'apagado'} · todavía no entraste`,
        accent: accentOf(server.id),
        icon: 'server',
        run: () => openOwnServer(server),
      });
    }

    const channelItems: Item[] = sessions.flatMap((session) =>
      (servers[session.key]?.channels ?? []).map((channel) => ({
        id: `c-${session.key}-${channel.id}`,
        section: 'canales' as const,
        title: channel.kind === 'voice' ? channel.name : `#${channel.name}`,
        match: `${channel.name} ${session.name}`,
        subtitle: session.name,
        icon: (channel.kind === 'voice' ? 'volume-2' : 'hash') as IconName,
        accent: accentOf(session.serverId),
        run: () => (channel.kind === 'voice' ? void openVoice(session.key, channel.id) : selectChannel(session.key, channel.id)),
      })),
    );

    const people: Item[] = sessions.flatMap((session) =>
      (members[session.key] ?? [])
        .filter((m) => m.id !== session.member.id)
        .map((m) => ({
          id: `p-${session.key}-${m.id}`,
          section: 'personas' as const,
          title: m.display_name,
          subtitle: `@${m.nickname} · ${session.name}`,
          person: { name: m.display_name, nick: m.nickname },
          run: () => selectDm(session.key, m.id),
        })),
    );

    return [...actions, ...serverItems, ...channelItems, ...people];
  }, [sessions, servers, members, nodeServers, view, call, nodeUrl]);

  const searching = Boolean(query.trim());
  const results = searching
    ? fuzzyFilter(items, query, (i) => i.match ?? `${i.title} ${i.subtitle ?? ''}`, 40)
    : items.filter((i) => i.section !== 'personas').slice(0, 24);
  // Buscando, la sección con la mejor coincidencia va primero: así Enter
  // elige lo que más se parece a lo que escribiste.
  const order = searching ? [...new Set(results.map((r) => r.section))] : SECTIONS;
  const grouped = order.map((section) => ({ section, items: results.filter((r) => r.section === section) })).filter((g) => g.items.length);
  const flat = grouped.flatMap((g) => g.items);

  useEffect(() => setSelected(0), [query]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((i) => (i + step + flat.length) % Math.max(1, flat.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(flat[selected]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  let index = -1;
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="wofi glass-strong" role="dialog" aria-label="Buscar">
        <div className="wofi-input">
          <span className="prompt">❯</span>
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="drun: servidores, canales, gente, acciones…"
            spellCheck={false}
          />
          <kbd>esc</kbd>
        </div>
        <div className="wofi-results">
          {grouped.length ? (
            grouped.map((group) => (
              <div key={group.section}>
                <div className="wofi-section">{group.section}</div>
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={i === selected ? 'wofi-item active' : 'wofi-item'}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => run(item)}
                    >
                      <span className="wofi-icon" style={item.accent ? { color: item.accent } : undefined}>
                        {item.person ? <Avatar name={item.person.name} nick={item.person.nick} size={26} /> : <Icon name={item.icon ?? 'chevron-right'} size={16} />}
                      </span>
                      <span className="wofi-text">
                        <span className="wofi-title">{item.title}</span>
                        {item.subtitle ? <span className="wofi-subtitle">{item.subtitle}</span> : null}
                      </span>
                      {i === selected ? <Icon name="corner-down-left" size={14} className="wofi-enter" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="wofi-empty">Nada coincide con “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
