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
  const session = useAppStore((state) => state.session);
  const editMessage = useAppStore((state) => state.editMessage);
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const react = useAppStore((state) => state.react);
  const uploadAttachment = useAppStore((state) => state.uploadAttachment);
  const downloadAttachment = useAppStore((state) => state.downloadAttachment);
  const deleteAttachment = useAppStore((state) => state.deleteAttachment);

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [attachTo, setAttachTo] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

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
            {editingId === message.id ? (
              <form
                className="message-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!editDraft.trim()) return;
                  void editMessage(channel.id, message.id, editDraft.trim()).then((ok) => {
                    if (ok) setEditingId(null);
                  });
                }}
              >
                <input value={editDraft} onChange={(event) => setEditDraft(event.target.value)} autoFocus />
                <button type="submit">Guardar</button>
                <button type="button" className="header-ghost" onClick={() => setEditingId(null)}>No</button>
              </form>
            ) : (
              <div className="message-content">
                {message.deleted ? <em>mensaje eliminado</em> : message.content}
                {message.edited_at && <span className="muted"> (editado)</span>}
              </div>
            )}
            {!message.deleted && message.attachments.length > 0 && (
              <div className="message-attachments">
                {message.attachments.map((id) => (
                  <span key={id} className="attachment-chip">
                    <button type="button" onClick={() => void downloadAttachment(id, id)}>📎 {id.slice(0, 8)}</button>
                    <button type="button" className="attachment-remove" onClick={() => void deleteAttachment(id)}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="reactions">
              {message.reactions.map((reaction) => (
                <button
                  key={`${reaction.emoji}:${reaction.nickname}`}
                  type="button"
                  className="reaction"
                  onClick={() => void react(channel.id, message.id, reaction.emoji, reaction.nickname === session?.member.nickname)}
                >
                  {reaction.emoji} <small>{reaction.nickname}</small>
                </button>
              ))}
              {!message.deleted && (
                <button type="button" className="reaction reaction--add" onClick={() => void react(channel.id, message.id, '👍', false)}>
                  + 👍
                </button>
              )}
              {!message.deleted && message.author.nickname === session?.member.nickname && (
                <>
                  <button
                    type="button"
                    className="reaction reaction--add"
                    onClick={() => {
                      setEditingId(message.id);
                      setEditDraft(message.content ?? '');
                    }}
                  >
                    ✎
                  </button>
                  <button type="button" className="reaction reaction--add" onClick={() => void deleteMessage(channel.id, message.id)}>🗑</button>
                  <button type="button" className="reaction reaction--add" onClick={() => {
                    setAttachTo(message.id);
                    fileRef.current?.click();
                  }}>📎</button>
                </>
              )}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>

      {typingHere.length > 0 && (
        <p className="typing muted">{typingHere.join(', ')} está escribiendo…</p>
      )}

      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && attachTo) void uploadAttachment(channel.id, attachTo, file);
          setAttachTo(null);
          event.target.value = '';
        }}
      />

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
