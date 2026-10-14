// Piezas de interfaz reutilizables: avatares, modales, menús y avisos.

import { icon, type IconName } from './icons';
import { byId, colorFor, h, initials, messageOf, type Child, type Props } from './util';

// ─── Avatar ───────────────────────────────────────────────────────────────────

export interface AvatarOptions {
  size?: 'xs' | 'sm' | 'md';
  speaking?: boolean;
  /** Marca el avatar para que el indicador de voz se actualice en el lugar,
   * sin redibujar la lista (ver `paintSpeaking` en app.ts). */
  speaker?: string | null;
}

export function avatar(name: string, key: string, options: AvatarOptions = {}): HTMLSpanElement {
  const { size = 'md', speaking = false, speaker = null } = options;
  return h(
    'span',
    {
      class: `avatar avatar-${size}${speaking ? ' is-speaking' : ''}`,
      style: { background: colorFor(key || name) },
      'aria-hidden': 'true',
      dataset: speaker ? { speaker } : null,
    },
    initials(name),
  );
}

// ─── Avisos ───────────────────────────────────────────────────────────────────

export type ToastKind = 'info' | 'success' | 'error';

export function toast(
  message: string,
  { kind = 'info', timeout = 4000 }: { kind?: ToastKind; timeout?: number } = {},
): void {
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  byId('toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

export async function copy(text: string, label = 'Copiado al portapapeles'): Promise<void> {
  try {
    if (window.recopBridge) await window.recopBridge.copy(text);
    else await navigator.clipboard.writeText(text);
    toast(label, { kind: 'success', timeout: 2000 });
  } catch {
    toast('No se pudo copiar. Seleccioná el texto y copialo a mano.', { kind: 'error' });
  }
}

// ─── Modales ──────────────────────────────────────────────────────────────────

export interface ModalHandle {
  close(): void;
  el: HTMLElement;
}

export interface ModalOptions {
  title: string;
  subtitle?: string;
  body: Child;
  footer?: Child;
  onClose?: () => void;
}

let activeModal: ModalHandle | null = null;

export function modal({ title, subtitle, body, footer, onClose }: ModalOptions): ModalHandle {
  closeModal();

  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { class: 'modal-title' }, title),
      subtitle ? h('p', { class: 'modal-subtitle' }, subtitle) : null,
      h('button', { class: 'icon-btn modal-close', title: 'Cerrar', onclick: () => close() }, icon('x', 20)),
    ),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null,
  );

  const backdrop = h(
    'div',
    {
      class: 'backdrop',
      onmousedown: (event) => {
        if (event.target === backdrop) close();
      },
    },
    dialog,
  );
  byId('modal-root').append(backdrop);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const handle: ModalHandle = { close, el: dialog };
  activeModal = handle;

  function close(): void {
    if (activeModal !== handle) return;
    activeModal = null;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  }

  const focusable = dialog.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-close)');
  if (focusable) setTimeout(() => focusable.focus(), 0);
  return handle;
}

export function closeModal(): void {
  activeModal?.close();
}

export interface FormModalOptions {
  title: string;
  subtitle?: string;
  fields: Child;
  submitLabel: string;
  danger?: boolean;
  onSubmit: (data: FormData, modal: ModalHandle) => Promise<void>;
  onClose?: () => void;
}

// Formulario dentro de un modal. `onSubmit` puede tirar un error: se muestra
// arriba del botón y el modal queda abierto para corregir.
export function formModal({
  title,
  subtitle,
  fields,
  submitLabel,
  danger = false,
  onSubmit,
  onClose,
}: FormModalOptions): ModalHandle {
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h(
    'button',
    { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' },
    submitLabel,
  );
  const cancel = h(
    'button',
    { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() },
    'Cancelar',
  );

  const form = h(
    'form',
    {
      class: 'form',
      onsubmit: async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        submit.disabled = true;
        submit.classList.add('is-loading');
        try {
          await onSubmit(new FormData(form), handle);
        } catch (error) {
          errorBox.textContent = messageOf(error);
          errorBox.hidden = false;
        } finally {
          submit.disabled = false;
          submit.classList.remove('is-loading');
        }
      },
    },
    fields,
    errorBox,
    h('div', { class: 'form-actions' }, cancel, submit),
  );

  const handle = modal({ title, subtitle, body: form, onClose });
  return handle;
}

// Un campo con etiqueta y ayuda: field('Nickname', input, 'Así te ven los demás')
export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
  );
}

export function input(props: Props): HTMLInputElement {
  return h('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', ...props });
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function confirmDialog({
  title,
  message,
  confirmLabel = 'Aceptar',
  danger = false,
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const handle = modal({
      title,
      body: h('p', { class: 'modal-text' }, message),
      footer: [
        h('button', { class: 'btn btn-ghost', onclick: () => handle.close() }, 'Cancelar'),
        h(
          'button',
          {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            onclick: () => {
              answered = true;
              handle.close();
              resolve(true);
            },
          },
          confirmLabel,
        ),
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

// ─── Menú emergente ───────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onClick: () => void;
}

export type MenuEntry = MenuItem | 'separator' | null;

let closeActivePopover: (() => void) | null = null;

// Se cierra al elegir una opción o al hacer clic afuera.
export function popover(
  anchor: HTMLElement,
  items: MenuEntry[],
  { align = 'start' }: { align?: 'start' | 'end' } = {},
): void {
  closePopover();
  const menu = h(
    'div',
    { class: 'popover', role: 'menu' },
    items.map((item) => {
      if (item === null) return null;
      if (item === 'separator') return h('div', { class: 'popover-sep' });
      return h(
        'button',
        {
          class: `popover-item${item.danger ? ' is-danger' : ''}`,
          role: 'menuitem',
          onclick: () => {
            closePopover();
            item.onClick();
          },
        },
        h('span', null, item.label),
        item.icon ? icon(item.icon, 16) : null,
      );
    }),
  );
  byId('popover-root').append(menu);

  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const left = align === 'end' ? rect.right - width : rect.left;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  const top = rect.bottom + 6;
  menu.style.top = `${Math.min(top, window.innerHeight - menu.offsetHeight - 8)}px`;

  const onDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (!menu.contains(target) && !anchor.contains(target)) closePopover();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closePopover();
  };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  document.addEventListener('keydown', onKey);

  closeActivePopover = () => {
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('keydown', onKey);
    menu.remove();
  };
}

export function closePopover(): void {
  closeActivePopover?.();
  closeActivePopover = null;
}

// ─── Estados vacíos ───────────────────────────────────────────────────────────

export interface EmptyStateOptions {
  iconName?: IconName;
  title: string;
  text?: string;
  actions?: Child;
}

export function emptyState({ iconName, title, text, actions }: EmptyStateOptions): HTMLDivElement {
  return h(
    'div',
    { class: 'empty' },
    iconName ? h('div', { class: 'empty-icon' }, icon(iconName, 32)) : null,
    h('h3', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    actions ? h('div', { class: 'empty-actions' }, actions) : null,
  );
}
