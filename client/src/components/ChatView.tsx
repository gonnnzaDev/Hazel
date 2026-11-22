import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAppStore } from '../state/store';

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatView() {
  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const servers = useAppStore((state) => state.servers);
  const selectedServerId = useAppStore((state) => state.selectedServerId);
  const messages = useAppStore((state) => state.messages);
  const cursors = useAppStore((state) => state.cursors);
  const typing = useAppStore((state) => state.typing);
  const loading = useAppStore((state) => state.loading);
  const send = useAppStore((state) => state.send);
  const loadMore = useAppStore((state) => state.loadMore);
  const notifyTyping = useAppStore((state) => state.notifyTyping);

  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingRef = useRef(0);

  const channel = servers
    .find((server) => server.id === selectedServerId)
    ?.channels.find((item) => item.id === selectedChannelId);
  const items = selectedChannelId ? (messages[selectedChannelId] ?? []) : [];
  const typingHere = selectedChannelId ? (typing[selectedChannelId] ?? []) : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items.length]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const content = draft;
    setDraft('');
    await send(content);
  }

  if (!channel) {
    return <div className="chat-empty muted">Selecciona un canal para empezar.</div>;
  }

  return (
    <div className="chat">
      <div className="messages">
        {cursors[channel.id] && (
          <button className="load-more" onClick={() => void loadMore()} disabled={loading}>
            Cargar mensajes anteriores
          </button>
        )}
        {items.length === 0 && <p className="empty">Aún no hay mensajes en #{channel.name}.</p>}
        {items.map((message) => (
          <article
            key={message.id}
            data-initial={(message.author.display_name ?? message.author.nickname).slice(0, 1).toUpperCase()}
            className={`message ${message.deleted ? 'is-deleted' : ''}`}
          >
            <div className="message-author">
              <strong>{message.author.display_name ?? message.author.nickname}</strong>
              <span className="muted">{formatTime(message.created_at)}</span>
            </div>
            <div className="message-content">
              {message.deleted ? <em>mensaje eliminado</em> : message.content}
              {message.edited_at && <span className="muted"> (editado)</span>}
            </div>
            {message.reactions.length > 0 && (
              <div className="reactions">
                {message.reactions.map((reaction) => (
                  <span key={`${reaction.emoji}:${reaction.nickname}`} className="reaction">
                    {reaction.emoji} <small>{reaction.nickname}</small>
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
        <div ref={bottomRef} />
      </div>

      {typingHere.length > 0 && (
        <p className="typing muted">{typingHere.join(', ')} está escribiendo…</p>
      )}

      <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const now = Date.now();
            if (now - lastTypingRef.current > 2_000) {
              lastTypingRef.current = now;
              notifyTyping();
            }
          }}
          placeholder={`Escribe en #${channel.name}`}
          maxLength={4000}
        />
        <button type="submit" disabled={!draft.trim()}>Enviar</button>
      </form>
    </div>
  );
}
