// El chat de un canal o de un mensaje directo: cabecera, mensajes, quién está
// escribiendo y el compositor con autocompletado.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { copy, deleteMessage, markCurrentRead, notifyTyping, sendText, toggleReaction } from '../actions';
import { slashCommands } from '../lib/commands';
import { emojiNames, emojis, quickReactions } from '../lib/emojis';
import { clock, dayLabel, isSameDay, stamp } from '../lib/format';
import { fuzzyFilter } from '../lib/fuzzy';
import { mentionsIn, plainText } from '../lib/markdown';
import type { ChatMessage, LocalNotice, Member, Role, Session } from '../lib/types';
import { openModal, toast, useApp } from '../store/app';
import { markRead, useChat } from '../store/chat';
import { useSettings } from '../store/settings';
import { useNow } from './hooks';
import { Markdown } from './Markdown';
import { Avatar, Icon, IconButton, PRESENCE_LABEL, RoleBadge } from './ui';

const GROUP_WINDOW_MS = 5 * 60_000;
const PAGE = 80;
const EMPTY: ChatMessage[] = [];
const NO_NOTICES: LocalNotice[] = [];

type Item = { kind: 'message'; message: ChatMessage } | { kind: 'notice'; notice: LocalNotice };

const ROLE_COLOR: Record<Role, string | undefined> = { owner: '#BFFF00', admin: '#00E5FF', member: undefined };

export interface ChatTarget {
  session: Session;
  /** Id del canal o `dm:…`. */
  channelId: string;
  title: string;
  subtitle?: string;
  /** Un DM: la otra persona. */
  peer?: { id: string; name: string; nick: string };
  /** Si no se puede escribir, por qué. */
  readOnly?: string;
}

// ─── Mensaje ──────────────────────────────────────────────────────────────────

interface MessageProps {
  message: ChatMessage;
  grouped: boolean;
  selfId: string;
  me: string;
  member?: Member;
  replyTo?: ChatMessage;
  nameOf: (nick: string) => string | undefined;
  onReply: (message: ChatMessage) => void;
  sessionKey: string;
}

const MessageItem = memo(function MessageItem({ message, grouped, selfId, me, member, replyTo, nameOf, onReply, sessionKey }: MessageProps) {
  const own = message.authorId === selfId;
  const mentionsMe = !own && mentionsIn(message.content).includes(me);
  const name = member?.display_name ?? message.name;
  const nick = member?.nickname ?? message.nick;
  const color = member ? ROLE_COLOR[member.role] : undefined;
  const openProfile = () => openModal({ kind: 'profile', key: sessionKey, memberId: message.authorId });
  const reactions = Object.entries(message.reactions).filter(([, people]) => people.length);

  return (
    <article className={['msg', grouped ? 'grouped' : '', mentionsMe ? 'mentions-me' : '', message.deleted ? 'deleted' : ''].filter(Boolean).join(' ')}>
      {replyTo ? (
        <div className="msg-reply">
          <Icon name="corner-up-left" size={12} />
          <span className="msg-reply-name">@{replyTo.nick}</span>
          <span className="msg-reply-text">{replyTo.deleted ? 'mensaje borrado' : plainText(replyTo.content).slice(0, 120)}</span>
        </div>
      ) : null}
      <div className="msg-row">
        <div className="msg-gutter">
          {grouped ? (
            <span className="msg-time-hover">{clock(new Date(message.createdAt))}</span>
          ) : (
            <button type="button" className="msg-avatar" onClick={openProfile} aria-label={`Perfil de ${name}`}>
              <Avatar name={name} nick={nick} size={38} />
            </button>
          )}
        </div>
        <div className="msg-main">
          {grouped ? null : (
            <div className="msg-head">
              <button type="button" className="msg-author" style={color ? { color } : undefined} onClick={openProfile}>
                {name}
              </button>
              {member ? <RoleBadge role={member.role} /> : null}
              <time className="msg-time" dateTime={new Date(message.createdAt).toISOString()}>
                {stamp(message.createdAt)}
              </time>
            </div>
          )}
          {message.deleted ? (
            <div className="msg-deleted">
              <Icon name="trash-2" size={12} /> mensaje borrado
            </div>
          ) : (
            <Markdown content={message.content} me={me} nameOf={nameOf} />
          )}
          {reactions.length ? (
            <div className="msg-reactions">
              {reactions.map(([emoji, people]) => (
                <button
                  key={emoji}
                  type="button"
                  className={people.includes(selfId) ? 'reaction mine' : 'reaction'}
                  onClick={() => toggleReaction(sessionKey, message.channelId, message.id, emoji)}
                  title={`${people.length} ${people.length === 1 ? 'persona' : 'personas'}`}
                >
                  <span>{emoji}</span>
                  <span className="reaction-count">{people.length}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {message.deleted ? null : (
          <div className="msg-tools" role="toolbar" aria-label="Acciones del mensaje">
            {quickReactions.slice(0, 4).map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="msg-tool emoji"
                onClick={() => toggleReaction(sessionKey, message.channelId, message.id, emoji)}
                title={`Reaccionar con ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <IconButton icon="corner-up-left" label="Responder" size={15} className="msg-tool" onClick={() => onReply(message)} />
            <IconButton
              icon="copy"
              label="Copiar texto"
              size={15}
              className="msg-tool"
              onClick={() => void copy(message.content).then(() => toast('Mensaje copiado', 'success'))}
            />
            {own ? (
              <IconButton
                icon="trash-2"
                label="Borrar"
                size={15}
                danger
                className="msg-tool"
                onClick={() => deleteMessage(sessionKey, message.channelId, message.id)}
              />
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
});

function Notice({ notice, me }: { notice: LocalNotice; me: string }) {
  return (
    <article className="msg notice">
      <div className="msg-row">
        <div className="msg-gutter">
          <span className="notice-icon">
            <Icon name="terminal" size={16} />
          </span>
        </div>
        <div className="msg-main">
          <div className="msg-head">
            <span className="msg-author notice-author">hazel</span>
            <span className="notice-tag">solo vos</span>
            <time className="msg-time">{stamp(notice.createdAt)}</time>
          </div>
          <Markdown content={notice.content} me={me} />
        </div>
      </div>
    </article>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────────

function MessageList({ target, onReply }: { target: ChatTarget; onReply: (message: ChatMessage) => void }) {
  const { session, channelId } = target;
  const messages = useChat((s) => s.messages[session.key]?.[channelId] ?? EMPTY);
  const notices = useChat((s) => s.notices[session.key]?.[channelId] ?? NO_NOTICES);
  const members = useApp((s) => s.members[session.key]);
  const [limit, setLimit] = useState(PAGE);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const selfId = session.member.id;
  const me = session.member.nickname;

  const byId = useMemo(() => new Map((members ?? []).map((m) => [m.id, m])), [members]);
  const byNick = useMemo(() => new Map((members ?? []).map((m) => [m.nickname, m.display_name])), [members]);
  const nameOf = useMemo(() => (nick: string) => byNick.get(nick), [byNick]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const items: Item[] = useMemo(() => {
    const all: Item[] = [
      ...messages.map((message) => ({ kind: 'message' as const, message })),
      ...notices.map((notice) => ({ kind: 'notice' as const, notice })),
    ];
    const at = (item: Item) => (item.kind === 'message' ? item.message.createdAt : item.notice.createdAt);
    return all.sort((a, b) => at(a) - at(b));
  }, [messages, notices]);

  const visible = items.slice(-limit);
  const hidden = items.length - visible.length;

  useEffect(() => {
    setLimit(PAGE);
    stick.current = true;
  }, [session.key, channelId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, channelId, messages]);

  useEffect(() => {
    if (document.hasFocus()) markRead(session.key, channelId);
  }, [messages.length, session.key, channelId]);

  return (
    <div
      className="chat-scroll"
      ref={scroller}
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      }}
    >
      {hidden > 0 ? (
        <button
          type="button"
          className="chat-more"
          onClick={() => {
            stick.current = false;
            setLimit((l) => l + PAGE);
          }}
        >
          <Icon name="chevron-down" size={14} className="flip" /> ver {Math.min(hidden, PAGE)} mensajes anteriores
        </button>
      ) : (
        <Welcome target={target} />
      )}
      {visible.map((item, i) => {
        const previous = visible[i - 1];
        const prevAt = previous ? (previous.kind === 'message' ? previous.message.createdAt : previous.notice.createdAt) : null;
        const at = item.kind === 'message' ? item.message.createdAt : item.notice.createdAt;
        const newDay = prevAt === null || !isSameDay(prevAt, at);
        const divider = newDay ? (
          <div className="day-divider" key={`d-${at}`}>
            <span>{dayLabel(at)}</span>
          </div>
        ) : null;
        if (item.kind === 'notice') {
          return (
            <div key={item.notice.id}>
              {divider}
              <Notice notice={item.notice} me={me} />
            </div>
          );
        }
        const { message } = item;
        const grouped =
          !newDay &&
          previous?.kind === 'message' &&
          previous.message.authorId === message.authorId &&
          !previous.message.deleted &&
          !message.replyTo &&
          message.createdAt - previous.message.createdAt < GROUP_WINDOW_MS;
        return (
          <div key={message.id}>
            {divider}
            <MessageItem
              message={message}
              grouped={grouped}
              selfId={selfId}
              me={me}
              member={byId.get(message.authorId)}
              replyTo={message.replyTo ? messageById.get(message.replyTo) : undefined}
              nameOf={nameOf}
              onReply={onReply}
              sessionKey={session.key}
            />
          </div>
        );
      })}
    </div>
  );
}

function Welcome({ target }: { target: ChatTarget }) {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-icon">
        {target.peer ? <Avatar name={target.peer.name} nick={target.peer.nick} size={56} /> : <Icon name="hash" size={28} />}
      </div>
      <h2>{target.peer ? target.peer.name : `Bienvenido a #${target.title}`}</h2>
      <p>
        {target.peer
          ? `Este es el comienzo de tu conversación privada con @${target.peer.nick}. Va directo de tu app a la suya.`
          : (target.subtitle ?? `Este es el comienzo de #${target.title}.`)}
      </p>
      <p className="chat-welcome-note">
        <Icon name="lock" size={12} /> Los mensajes viajan de app a app y cada una guarda su historial. Al conectarse, se
        pasan lo que falta.
      </p>
    </div>
  );
}

function Typing({ sessionKey, channelId, selfId }: { sessionKey: string; channelId: string; selfId: string }) {
  const typing = useChat((s) => s.typing[sessionKey]?.[channelId]);
  const members = useApp((s) => s.members[sessionKey]);
  const now = useNow(1000);
  const names = Object.entries(typing ?? {})
    .filter(([id, until]) => id !== selfId && until > now)
    .map(([id]) => members?.find((m) => m.id === id)?.display_name ?? 'Alguien');
  return (
    <div className="typing" aria-live="polite">
      {names.length ? (
        <>
          <span className="typing-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            {names.length === 1
              ? `${names[0]} está escribiendo…`
              : names.length < 4
                ? `${names.join(', ')} están escribiendo…`
                : 'Varias personas están escribiendo…'}
          </span>
        </>
      ) : null}
    </div>
  );
}

// ─── Compositor ───────────────────────────────────────────────────────────────

interface Suggestion {
  key: string;
  label: string;
  detail?: string;
  icon?: string;
  /** Lo que reemplaza al token que se está escribiendo. */
  insert: string;
}

function tokenAt(text: string, caret: number): { start: number; token: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)([/:@][\w.+-]*)$/);
  if (!match) return null;
  const token = match[2] ?? '';
  return { start: caret - token.length, token };
}

function Composer({ target, replyTo, onCancelReply }: { target: ChatTarget; replyTo: ChatMessage | null; onCancelReply: () => void }) {
  const { session, channelId } = target;
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const members = useApp((s) => s.members[session.key]);
  const drafts = useRef(new Map<string, string>());

  // Cada canal guarda su borrador mientras la app está abierta.
  useEffect(() => {
    setText(drafts.current.get(channelId) ?? '');
    input.current?.focus();
  }, [channelId]);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const current = tokenAt(text, caret);
  const suggestions: Suggestion[] = useMemo(() => {
    if (!current || current.token === dismissed) return [];
    const { token, start } = current;
    const query = token.slice(1);
    if (token.startsWith('/') && start === 0) {
      return fuzzyFilter(slashCommands, query, (c) => c.name, 8).map((c) => ({
        key: c.name,
        label: `/${c.name}${c.args ? ` ${c.args}` : ''}`,
        detail: c.description,
        insert: `/${c.name} `,
      }));
    }
    if (token.startsWith(':') && query.length >= 2) {
      return fuzzyFilter(emojiNames, query, (n) => n, 8).map((n) => ({
        key: n,
        label: `:${n}:`,
        icon: emojis[n],
        insert: `${emojis[n] ?? `:${n}:`} `,
      }));
    }
    if (token.startsWith('@')) {
      return fuzzyFilter(members ?? [], query, (m) => `${m.nickname} ${m.display_name}`, 8).map((m) => ({
        key: m.id,
        label: m.display_name,
        detail: `@${m.nickname}`,
        insert: `@${m.nickname} `,
      }));
    }
    return [];
  }, [current, members, dismissed]);

  useEffect(() => setSelected(0), [suggestions.length, current?.token]);

  const accept = (s: Suggestion) => {
    if (!current) return;
    const next = text.slice(0, current.start) + s.insert + text.slice(caret);
    const position = current.start + s.insert.length;
    setText(next);
    drafts.current.set(channelId, next);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  const submit = () => {
    const value = text;
    if (!value.trim()) return;
    setText('');
    drafts.current.set(channelId, '');
    onCancelReply();
    void sendText(session.key, channelId, value, replyTo?.id ?? null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelected((i) => (i + step + suggestions.length) % suggestions.length);
        return;
      }
      const s = suggestions[selected];
      // Si ya está escrito entero ("/help", "@luis"), Enter lo manda en vez de completarlo.
      const complete = event.key === 'Enter' && s && current && s.insert.trim() === current.token;
      if (!complete && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
        event.preventDefault();
        if (s) accept(s);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(current?.token ?? null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && replyTo) {
      onCancelReply();
    }
  };

  if (target.readOnly) {
    return (
      <div className="composer readonly">
        <Icon name="lock" size={14} />
        <span>{target.readOnly}</span>
      </div>
    );
  }

  const placeholder = target.peer ? `Mensaje para @${target.peer.nick}` : `Escribí en #${target.title}`;

  return (
    <div className="composer-wrap">
      {suggestions.length ? (
        <div className="autocomplete glass-strong" role="listbox">
          <div className="autocomplete-head">
            {current?.token.startsWith('/') ? 'comandos' : current?.token.startsWith(':') ? 'emojis' : 'personas'}
          </div>
          {suggestions.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'autocomplete-item active' : 'autocomplete-item'}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(s);
              }}
              onMouseEnter={() => setSelected(i)}
            >
              {s.icon ? <span className="autocomplete-emoji">{s.icon}</span> : null}
              <span className="autocomplete-label">{s.label}</span>
              {s.detail ? <span className="autocomplete-detail">{s.detail}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {replyTo ? (
        <div className="reply-bar">
          <Icon name="corner-up-left" size={14} />
          <span>
            Respondiendo a <strong>@{replyTo.nick}</strong>: {plainText(replyTo.content).slice(0, 80)}
          </span>
          <IconButton icon="x" label="Cancelar respuesta" size={14} onClick={onCancelReply} />
        </div>
      ) : null}
      <div className="composer glass-strong">
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
            setDismissed(null);
            drafts.current.set(channelId, event.target.value);
            if (event.target.value.trim() && !event.target.value.startsWith('/')) notifyTyping(session.key, channelId);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <IconButton icon="send" label="Enviar (Enter)" className={text.trim() ? 'send ready' : 'send'} onClick={submit} disabled={!text.trim()} />
      </div>
      <div className="composer-hint">
        <span>
          <kbd>Enter</kbd> envía · <kbd>Shift</kbd>+<kbd>Enter</kbd> nueva línea · <kbd>/</kbd> comandos · <kbd>:</kbd> emojis · <kbd>@</kbd> menciones
        </span>
      </div>
    </div>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export function Chat({ target }: { target: ChatTarget }) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const bus = useChat((s) => s.bus[target.session.key]);
  const presence = useChat(useShallow((s) => (target.peer ? s.presence[target.session.key]?.[target.peer.id] : undefined)));
  const showMembers = useSettings((s) => s.showMembers);

  useEffect(() => setReplyTo(null), [target.channelId]);
  useEffect(() => {
    const onFocus = () => markCurrentRead();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const peers = bus?.connected.length ?? 0;
  const busLabel =
    bus?.status === 'online'
      ? peers
        ? `p2p · ${peers} ${peers === 1 ? 'conectado' : 'conectados'}`
        : 'p2p · solo vos'
      : bus?.status === 'connecting'
        ? 'conectando…'
        : bus?.status === 'expired'
          ? 'sesión vencida'
          : 'sin conexión';

  return (
    <section className="chat panel glass" aria-label={target.title}>
      <header className="chat-head">
        {target.peer ? (
          <Avatar name={target.peer.name} nick={target.peer.nick} size={30} presence={presence?.online ? presence.presence : 'offline'} />
        ) : (
          <Icon name="hash" size={20} className="accent" />
        )}
        <div className="chat-head-text">
          <h1>{target.title}</h1>
          {target.peer ? (
            <span>{presence?.online ? presence.text || PRESENCE_LABEL[presence.presence] : 'desconectado'}</span>
          ) : target.subtitle ? (
            <span>{target.subtitle}</span>
          ) : null}
        </div>
        <span className={`chip ${bus?.status === 'online' ? 'chip-ok' : 'chip-warn'}`} title="Los mensajes van directo entre las apps conectadas">
          <Icon name={bus?.status === 'online' ? 'wifi' : 'wifi-off'} size={12} />
          {busLabel}
        </span>
        {target.peer ? null : (
          <IconButton
            icon="users"
            label={showMembers ? 'Ocultar miembros' : 'Mostrar miembros'}
            active={showMembers}
            onClick={() => useSettings.getState().set({ showMembers: !showMembers })}
          />
        )}
      </header>
      <MessageList target={target} onReply={setReplyTo} />
      <Typing sessionKey={target.session.key} channelId={target.channelId} selfId={target.session.member.id} />
      <Composer target={target} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
    </section>
  );
}
