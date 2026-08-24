import type { ReactElement, ReactNode } from 'react';
import { Button } from './button.js';
import { useModalFocus } from './use-modal-focus.js';

export interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** Destructive confirmations render the confirm action in the danger style. */
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * A blocking yes/no prompt. Every destructive operation goes through one of
 * these - nothing irreversible fires off a single click. Cancel takes
 * initial focus so Enter never destroys anything by default.
 */
export function ConfirmDialog({
  title,
  children,
  cancelLabel,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  // Cancel is the first focusable, so initial focus lands there and
  // Enter never destroys anything by default; Tab stays inside and
  // focus returns to the opener on close (WP-31).
  const boxRef = useModalFocus<HTMLDivElement>();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mio-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div ref={boxRef} className="w-full max-w-sm rounded-card bg-surface p-6 shadow-raised">
        <h2 id="mio-confirm-title" className="font-display text-lg italic text-ink">
          {title}
        </h2>
        {children !== undefined ? (
          <div className="mt-2 text-sm leading-relaxed text-secondary">{children}</div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onPress={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} isDisabled={busy} onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
