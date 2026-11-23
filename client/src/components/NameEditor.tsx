import { useEffect, useState, type FormEvent } from 'react';
import { useAppStore } from '../state/store';

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Diálogo para cambiar el único nombre público del miembro. */
export function NameEditor({ open, onClose }: Props) {
  const current = useAppStore((state) => state.session?.member.display_name ?? '');
  const rename = useAppStore((state) => state.rename);
  const loading = useAppStore((state) => state.loading);
  const [name, setName] = useState(current);

  useEffect(() => {
    if (open) setName(current);
  }, [open, current]);

  if (!open) return null;

  const trimmed = name.trim();
  const invalid = trimmed.length < 2 || trimmed.length > 64;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    await rename(trimmed);
    onClose();
  }

  return (
    <div className="gallery-backdrop" onClick={onClose} role="presentation">
      <form
        className="name-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Cambiar nombre"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <h2>Cambiar nombre</h2>
        <p className="muted">Este es el nombre que ven los demás en este servidor.</p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ana"
          minLength={2}
          maxLength={64}
          autoFocus
        />
        <div className="name-editor-actions">
          <button type="button" className="header-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={loading || invalid}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
