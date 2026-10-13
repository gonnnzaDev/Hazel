// Piezas de interfaz reutilizables: avatares, modales, menús y avisos.

(function (R) {
  'use strict';

  const { h, clear, initials, colorFor } = R.util;
  const { icon } = R.icons;

  // ─── Avatar ─────────────────────────────────────────────────────────────────

  // `speaker` marca el avatar para que el indicador de voz se actualice en el
  // lugar, sin redibujar la lista (ver `Recop.actions.paintSpeaking`).
  function avatar(name, key, { size = 'md', speaking = false, speaker = null } = {}) {
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

  // ─── Avisos ─────────────────────────────────────────────────────────────────

  function toast(message, { kind = 'info', timeout = 4000 } = {}) {
    const el = h(
      'div',
      { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      message,
    );
    document.getElementById('toasts').append(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 200);
    }, timeout);
  }

  async function copy(text, label = 'Copiado al portapapeles') {
    try {
      if (window.recopBridge) await window.recopBridge.copy(text);
      else await navigator.clipboard.writeText(text);
      toast(label, { kind: 'success', timeout: 2000 });
    } catch {
      toast('No se pudo copiar. Seleccioná el texto y copialo a mano.', { kind: 'error' });
    }
  }

  // ─── Modales ────────────────────────────────────────────────────────────────

  let activeModal = null;

  // modal({ title, subtitle, body, actions, onClose }) → { close, el }
  function modal({ title, subtitle, body, footer, size = 'sm', onClose }) {
    closeModal();
    const root = document.getElementById('modal-root');

    const dialog = h(
      'div',
      { class: `modal modal-${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { class: 'modal-title' }, title),
        subtitle ? h('p', { class: 'modal-subtitle' }, subtitle) : null,
        h(
          'button',
          { class: 'icon-btn modal-close', title: 'Cerrar', onclick: () => close() },
          icon('x', 20),
        ),
      ),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    );

    const backdrop = h(
      'div',
      { class: 'backdrop', onmousedown: (e) => e.target === backdrop && close() },
      dialog,
    );
    root.append(backdrop);

    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    function close() {
      if (activeModal !== handle) return;
      activeModal = null;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (onClose) onClose();
    }

    const handle = { close, el: dialog };
    activeModal = handle;

    const focusable = dialog.querySelector('input, textarea, select, button:not(.modal-close)');
    if (focusable) setTimeout(() => focusable.focus(), 0);
    return handle;
  }

  function closeModal() {
    if (activeModal) activeModal.close();
  }

  // Formulario dentro de un modal. `onSubmit` puede tirar un error: se muestra
  // arriba del botón y el modal queda abierto para corregir.
  function formModal({ title, subtitle, fields, submitLabel, danger = false, onSubmit, onClose, extra }) {
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
            errorBox.textContent = error.message || 'Algo salió mal.';
            errorBox.hidden = false;
          } finally {
            submit.disabled = false;
            submit.classList.remove('is-loading');
          }
        },
      },
      fields,
      extra || null,
      errorBox,
      h('div', { class: 'form-actions' }, cancel, submit),
    );

    const handle = modal({ title, subtitle, body: form, onClose });
    return handle;
  }

  // Un campo con etiqueta y ayuda: field('Nickname', input, 'Así te ven los demás')
  function field(label, control, hint) {
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, label),
      control,
      hint ? h('span', { class: 'field-hint' }, hint) : null,
    );
  }

  function input(props) {
    return h('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', ...props });
  }

  function confirmDialog({ title, message, confirmLabel = 'Aceptar', danger = false }) {
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

  // ─── Menú emergente ─────────────────────────────────────────────────────────

  let activePopover = null;

  // popover(anchor, [{ label, icon, onClick, danger }]) — se cierra al elegir o
  // al hacer clic afuera.
  function popover(anchor, items, { align = 'start' } = {}) {
    closePopover();
    const root = document.getElementById('popover-root');
    const menu = h(
      'div',
      { class: 'popover', role: 'menu' },
      items.filter(Boolean).map((item) =>
        item === 'separator'
          ? h('div', { class: 'popover-sep' })
          : h(
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
            ),
      ),
    );
    root.append(menu);

    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = align === 'end' ? rect.right - width : rect.left;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    const top = rect.bottom + 6;
    menu.style.top = `${Math.min(top, window.innerHeight - menu.offsetHeight - 8)}px`;

    const onDown = (event) => {
      if (!menu.contains(event.target) && !anchor.contains(event.target)) closePopover();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') closePopover();
    };
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);

    activePopover = {
      close() {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
        menu.remove();
      },
    };
  }

  function closePopover() {
    if (activePopover) {
      activePopover.close();
      activePopover = null;
    }
  }

  // ─── Estados vacíos ─────────────────────────────────────────────────────────

  function emptyState({ iconName, title, text, actions }) {
    return h(
      'div',
      { class: 'empty' },
      iconName ? h('div', { class: 'empty-icon' }, icon(iconName, 32)) : null,
      h('h3', { class: 'empty-title' }, title),
      text ? h('p', { class: 'empty-text' }, text) : null,
      actions ? h('div', { class: 'empty-actions' }, actions) : null,
    );
  }

  R.ui = {
    avatar,
    toast,
    copy,
    modal,
    closeModal,
    formModal,
    field,
    input,
    confirmDialog,
    popover,
    closePopover,
    emptyState,
    clear,
  };
})(window.Recop);
