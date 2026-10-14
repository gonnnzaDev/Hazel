// La gente del servidor, por rol. "En línea" es tener la app abierta y
// conectada a este servidor ahora mismo (se sabe por la sala P2P).

import { useShallow } from 'zustand/react/shallow';

import type { Member, Role, Session } from '../lib/types';
import { openModal, useApp } from '../store/app';
import type { PeerPresence } from '../store/chat';
import { useChat } from '../store/chat';
import { useVoice } from '../store/voice';
import { Avatar, Icon, PRESENCE_LABEL, ROLE_LABEL } from './ui';

const ORDER: Role[] = ['owner', 'admin', 'member'];
const GROUP_LABEL: Record<Role, string> = { owner: 'dueño', admin: 'admins', member: 'miembros' };
const ROLE_COLOR: Record<Role, string | undefined> = { owner: '#BFFF00', admin: '#00E5FF', member: undefined };

function MemberRow({ session, member, presence, inVoice }: { session: Session; member: Member; presence?: PeerPresence; inVoice: boolean }) {
  const online = Boolean(presence?.online);
  const status = online ? presence?.text || PRESENCE_LABEL[presence?.presence ?? 'online'] : 'desconectado';
  return (
    <button
      type="button"
      className={online ? 'member-row' : 'member-row offline'}
      onClick={() => openModal({ kind: 'profile', key: session.key, memberId: member.id })}
      title={`${member.display_name} · @${member.nickname} · ${ROLE_LABEL[member.role]}`}
    >
      <Avatar name={member.display_name} nick={member.nickname} size={32} presence={online ? (presence?.presence ?? 'online') : 'offline'} />
      <span className="member-text">
        <span className="member-name" style={ROLE_COLOR[member.role] && online ? { color: ROLE_COLOR[member.role] } : undefined}>
          {member.display_name}
          {member.id === session.member.id ? <span className="dim"> (vos)</span> : null}
        </span>
        <span className="member-status">{status}</span>
      </span>
      {inVoice ? <Icon name="volume-2" size={13} className="member-voice" /> : null}
    </button>
  );
}

export function Members({ session }: { session: Session }) {
  const members = useApp((s) => s.members[session.key]);
  const presence = useChat(useShallow((s) => s.presence[session.key] ?? {}));
  const rooms = useApp((s) => s.voiceRooms[session.key]);
  const call = useVoice((s) => (s.call?.key === session.key ? s.call : null));
  const inVoice = new Set([
    ...Object.values(rooms ?? {}).flatMap((people) => people.map((p) => p.member_id)),
    ...(call?.participants.map((p) => p.member_id) ?? []),
  ]);

  if (!members) {
    return (
      <aside className="members glass" aria-label="Miembros">
        <div className="sidebar-loading">
          <span className="spinner" /> cargando miembros…
        </div>
      </aside>
    );
  }

  const online = members.filter((m) => presence[m.id]?.online);
  return (
    <aside className="members glass" aria-label="Miembros">
      <div className="members-head">
        <span>miembros</span>
        <span className="dim">
          {online.length}/{members.length} en línea
        </span>
      </div>
      <div className="members-scroll">
        {ORDER.map((role) => {
          const group = members
            .filter((m) => m.role === role)
            .sort((a, b) => Number(Boolean(presence[b.id]?.online)) - Number(Boolean(presence[a.id]?.online)) || a.display_name.localeCompare(b.display_name));
          if (!group.length) return null;
          return (
            <section key={role} className="members-group">
              <h3>
                {GROUP_LABEL[role]} — {group.length}
              </h3>
              {group.map((m) => (
                <MemberRow key={m.id} session={session} member={m} presence={presence[m.id]} inVoice={inVoice.has(m.id)} />
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
