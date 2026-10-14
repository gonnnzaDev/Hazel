// Piezas chicas que usa toda la interfaz.

import icons from 'feather-icons/dist/icons.json';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

import { alpha, avatarColorOf, initials } from '../lib/color';
import { LOGO_GLYPH } from '../lib/logo';
import type { Presence, Role } from '../lib/types';

// ─── Íconos (Feather, MIT) ────────────────────────────────────────────────────

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Contenido fijo del paquete de íconos, nunca texto de la gente.
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}

export function Logo({ size = 28, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <svg className={glow ? 'logo logo-glow' : 'logo'} viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      <rect width="1024" height="1024" rx="232" fill="#F27BA8" />
      <path fill="#fff" fillRule="evenodd" d={LOGO_GLYPH} />
    </svg>
  );
}

// ─── Gente ────────────────────────────────────────────────────────────────────

export const PRESENCE_LABEL: Record<Presence | 'offline', string> = {
  online: 'En línea',
  idle: 'Ausente',
  dnd: 'No molestar',
  offline: 'Desconectado',
};

export function Avatar({
  name,
  nick,
  size = 36,
  presence,
  speaking = false,
}: {
  name: string;
  nick: string;
  size?: number;
  /** `undefined`: sin puntito. */
  presence?: Presence | 'offline';
  speaking?: boolean;
}) {
  const color = avatarColorOf(nick);
  return (
    <span className={speaking ? 'avatar speaking' : 'avatar'} style={{ width: size, height: size }}>
      <span
        className="avatar-face"
        style={{ background: `linear-gradient(135deg, ${color}, ${alpha(color, 0.55)})`, fontSize: size * 0.38 }}
      >
        {initials(name || nick, 2)}
      </span>
      {presence ? <span className={`presence presence-${presence}`} style={{ width: size * 0.32, height: size * 0.32 }} /> : null}
    </span>
  );
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Dueño', admin: 'Admin', member: 'Miembro' };

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'member') return null;
  return (
    <span className={`role-badge role-${role}`}>
      <Icon name={role === 'owner' ? 'star' : 'shield'} size={10} />
      {ROLE_LABEL[role]}
    </span>
  );
}

// ─── Contadores ───────────────────────────────────────────────────────────────

export function Badge({ count, mention = false }: { count: number; mention?: boolean }) {
  if (count <= 0) return null;
  return <span className={mention ? 'badge badge-mention' : 'badge'}>{count > 99 ? '99+' : count}</span>;
}

// ─── Botones y campos ─────────────────────────────────────────────────────────

type Tone = 'cyan' | 'purple' | 'lime' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  solid?: boolean;
  icon?: IconName;
  loading?: boolean;
  small?: boolean;
}

export function Button({ tone = 'cyan', solid = false, icon, loading = false, small = false, children, className, disabled, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${tone}`, solid ? 'btn-solid' : '', small ? 'btn-small' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={small ? 14 : 16} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active = false,
  danger = false,
  size = 18,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean; danger?: boolean; size?: number }) {
  const classes = ['icon-btn', active ? 'active' : '', danger ? 'danger' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: IconName;
  hint?: ReactNode;
  error?: string | null;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, icon, hint, error, id, ...rest }, ref) {
  const inputId = id ?? `f-${label.replace(/\W+/g, '-')}`;
  const noteId = `${inputId}-note`;
  return (
    <div className={error ? 'field has-error' : 'field'}>
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <span className="field-box">
        {icon ? <Icon name={icon} size={16} /> : null}
        <input
          ref={ref}
          id={inputId}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? noteId : undefined}
          {...rest}
        />
      </span>
      {error ? (
        <span id={noteId} className="field-error">
          {error}
        </span>
      ) : hint ? (
        <span id={noteId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
});

export function Spinner() {
  return <span className="spinner" />;
}
