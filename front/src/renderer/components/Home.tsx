// "Mi nodo": el panel del dueño. Tus servidores (crear, encender, apagar,
// borrar, copiar la dirección, abrir), los servidores de otros en los que
// estás, y los widgets de la máquina.

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { confirmDeleteServer, copyAddress, openOwnServer, refreshNode, selectSession, toggleServer } from '../actions';
import { accentOf, alpha, initials } from '../lib/color';
import type { Server } from '../lib/types';
import { openModal, useApp } from '../store/app';
import { unreadOfSession, useChat } from '../store/chat';
import { sessionKey, useSessions } from '../store/sessions';
import { useSettings } from '../store/settings';
import { Button, Icon, IconButton } from './ui';
import { CpuMonitor, NetMonitor } from './Widgets';
import { UserBar } from './Sidebar';

const STATUS: Record<Server['status'], { label: string; tone: string }> = {
  active: { label: 'encendido', tone: 'on' },
  inactive: { label: 'apagado', tone: 'off' },
  creating: { label: 'arrancando', tone: 'wait' },
  deleted: { label: 'borrado', tone: 'off' },
};

function ServerTile({ server }: { server: Server }) {
  const nodeUrl = useSettings((s) => s.nodeUrl);
  const key = sessionKey(nodeUrl, server.id);
  const joined = useSessions((s) => s.sessions.some((x) => x.key === key && !x.expired));
  const [busy, setBusy] = useState(false);
  const accent = accentOf(server.id);
  const status = STATUS[server.status];
  const on = server.status === 'active';

  return (
    <div className="server-tile" style={{ borderColor: on ? alpha(accent, 0.45) : undefined, boxShadow: on ? `0 0 24px ${alpha(accent, 0.12)}` : undefined }}>
      <div className="server-tile-icon" style={{ color: accent, borderColor: alpha(accent, 0.6), background: alpha(accent, 0.08) }}>
        {initials(server.name)}
      </div>
      <div className="server-tile-text">
        <div className="server-tile-name">
          {server.name}
          <span className={`pill pill-${status.tone}`}>{status.label}</span>
        </div>
        <div className="server-tile-meta mono">
          /{server.slug} · {server.channels.length} canales
        </div>
      </div>
      <div className="server-tile-actions">
        <IconButton icon="copy" label="Copiar dirección para invitar" onClick={() => void copyAddress(nodeUrl, server)} />
        <Button
          tone={on ? 'ghost' : 'lime'}
          small
          icon="power"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void toggleServer(server).finally(() => setBusy(false));
          }}
        >
          {on ? 'Apagar' : 'Encender'}
        </Button>
        <Button tone="cyan" solid small icon="log-in" disabled={!on} onClick={() => openOwnServer(server)} title={on ? undefined : 'Encendelo para entrar'}>
          {joined ? 'Abrir' : 'Entrar'}
        </Button>
        <IconButton icon="trash-2" label="Borrar servidor" danger onClick={() => confirmDeleteServer(server)} />
      </div>
    </div>
  );
}

function OtherServers() {
  const nodeUrl = useSettings((s) => s.nodeUrl);
  const sessions = useSessions(useShallow((s) => s.sessions.filter((x) => x.baseUrl !== nodeUrl)));
  const chat = useChat();
  if (!sessions.length) return null;
  return (
    <section className="home-card glass">
      <header className="home-card-head">
        <h2>
          <Icon name="globe" size={16} /> servidores de otros
        </h2>
      </header>
      <div className="home-list">
        {sessions.map((session) => {
          const unread = unreadOfSession(chat, session.key, session.member.id, session.member.nickname);
          const accent = accentOf(session.serverId);
          return (
            <button key={session.key} type="button" className="session-row" onClick={() => selectSession(session.key)}>
              <span className="server-tile-icon small" style={{ color: accent, borderColor: alpha(accent, 0.6) }}>
                {initials(session.name)}
              </span>
              <span className="session-row-text">
                <span>{session.name}</span>
                <span className="mono dim">
                  {new URL(session.baseUrl).host}/{session.slug} · @{session.member.nickname}
                </span>
              </span>
              {session.expired ? <span className="pill pill-off">vencida</span> : null}
              {unread.count ? <span className="pill pill-on">{unread.count} sin leer</span> : null}
              <Icon name="chevron-right" size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Home() {
  const node = useApp((s) => s.node);
  const nodeUrl = useSettings((s) => s.nodeUrl);
  const host = (() => {
    try {
      return new URL(nodeUrl).host;
    } catch {
      return nodeUrl;
    }
  })();
  const servers = [...node.servers].sort((a, b) => a.name.localeCompare(b.name));
  const on = servers.filter((s) => s.status === 'active').length;

  return (
    <div className="home">
      <aside className="sidebar glass home-side">
        <div className="home-side-head">
          <span className="prompt">~/</span>mi-nodo
        </div>
        <div className="home-side-body">
          <div className="kv">
            <span>estado</span>
            <span className={`kv-status ${node.status}`}>
              <span className="status-dot on" />
              {node.status === 'online' ? 'conectado' : node.status === 'connecting' ? 'conectando…' : 'no responde'}
            </span>
          </div>
          <div className="kv">
            <span>dirección</span>
            <span className="mono">{host}</span>
          </div>
          {node.info ? (
            <>
              <div className="kv">
                <span>versión</span>
                <span className="mono">hazel {node.info.version}</span>
              </div>
              <div className="kv">
                <span>entorno</span>
                <span className="mono">{node.info.environment}</span>
              </div>
            </>
          ) : null}
          <div className="kv">
            <span>encendidos</span>
            <span className="mono">
              {on} de {servers.length}
            </span>
          </div>
          {node.address?.candidates.length ? (
            <div className="kv kv-col">
              <span>en tu red</span>
              {node.address.candidates
                .filter((c) => !c.loopback)
                .slice(0, 3)
                .map((c) => (
                  <span key={c.host} className="mono">
                    {c.host}:{node.address?.port}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
        <div className="home-side-actions">
          <Button tone="purple" solid icon="plus" onClick={() => openModal({ kind: 'create' })} disabled={node.status !== 'online'}>
            Crear servidor
          </Button>
          <Button tone="cyan" icon="log-in" onClick={() => openModal({ kind: 'join' })}>
            Unirme con una dirección
          </Button>
        </div>
        <div className="sidebar-spacer" />
        <UserBar session={null} />
      </aside>

      <main className="home-main panel glass">
        <header className="home-head">
          <div>
            <h1>
              <span className="prompt">~/</span>servidores
            </h1>
            <p>Corren en esta compu. Apagar uno no borra nada: cuando lo encendés, está todo como lo dejaste.</p>
          </div>
          <IconButton icon="refresh-cw" label="Actualizar" onClick={() => void refreshNode()} />
        </header>

        {node.status === 'offline' ? (
          <div className="node-down">
            <Icon name="alert-triangle" size={22} />
            <div>
              <strong>Tu nodo no responde en {host}.</strong>
              <p>Levantalo desde la carpeta del proyecto y esta pantalla se actualiza sola:</p>
              <pre className="mono">uv run python -m core node</pre>
              <p className="dim">{node.error}</p>
              <Button tone="ghost" small icon="settings" onClick={() => openModal({ kind: 'settings' })}>
                Cambiar la dirección del nodo
              </Button>
            </div>
          </div>
        ) : servers.length ? (
          <div className="home-list">
            {servers.map((server) => (
              <ServerTile key={server.id} server={server} />
            ))}
          </div>
        ) : node.status === 'online' ? (
          <div className="home-empty">
            <Icon name="server" size={32} />
            <h2>Todavía no tenés servidores</h2>
            <p>Creá uno: queda en tu compu y le pasás la dirección a quien quieras.</p>
            <Button tone="purple" solid icon="plus" onClick={() => openModal({ kind: 'create' })}>
              Crear mi primer servidor
            </Button>
          </div>
        ) : (
          <div className="home-empty">
            <span className="spinner" /> conectando con tu nodo…
          </div>
        )}

        <OtherServers />

        <div className="widgets-row">
          <NetMonitor />
          <CpuMonitor />
        </div>
      </main>
    </div>
  );
}
