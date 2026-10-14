// Lo que flota arriba de todo: avisos y el panel de menciones.

import { mentionsOfMe, selectChannel, selectDm } from '../actions';
import { relative } from '../lib/format';
import { plainText } from '../lib/markdown';
import { useApp } from '../store/app';
import { dmPeer, isDm, useChat } from '../store/chat';
import { getSession } from '../store/sessions';
import { Avatar, Icon } from './ui';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass-strong toast-${t.tone}`}>
          <Icon name={t.tone === 'error' ? 'alert-circle' : t.tone === 'success' ? 'check-circle' : 'info'} size={16} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function MentionsPanel() {
  const open = useApp((s) => s.mentionsOpen);
  useChat((s) => s.messages);
  const servers = useApp((s) => s.servers);
  if (!open) return null;
  const items = mentionsOfMe();
  const close = () => useApp.setState({ mentionsOpen: false });
  return (
    <div className="overlay clear" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="mentions glass-strong" role="dialog" aria-label="Menciones">
        <header className="mentions-head">
          <span>
            <Icon name="at-sign" size={14} /> menciones y mensajes directos
          </span>
          <span className="dim">{items.length}</span>
        </header>
        <div className="mentions-list">
          {items.length ? (
            items.map(({ key, message }) => {
              const session = getSession(key);
              const channel = servers[key]?.channels.find((c) => c.id === message.channelId);
              const where = isDm(message.channelId) ? 'mensaje directo' : `#${channel?.name ?? 'canal'}`;
              return (
                <button
                  key={`${key}-${message.id}`}
                  type="button"
                  className="mention-item"
                  onClick={() => {
                    close();
                    if (isDm(message.channelId) && session) selectDm(key, dmPeer(message.channelId, session.member.id));
                    else selectChannel(key, message.channelId);
                  }}
                >
                  <Avatar name={message.name} nick={message.nick} size={32} />
                  <span className="mention-text">
                    <span className="mention-where">
                      {message.name} · {where} · {session?.name}
                    </span>
                    <span className="mention-body">{plainText(message.content).slice(0, 160)}</span>
                  </span>
                  <span className="mention-time">{relative(message.createdAt)}</span>
                </button>
              );
            })
          ) : (
            <div className="wofi-empty">Nadie te nombró todavía. Cuando alguien escriba @tu_nickname, aparece acá.</div>
          )}
        </div>
      </div>
    </div>
  );
}
