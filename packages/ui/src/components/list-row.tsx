import type { ReactElement, ReactNode } from 'react';

/** Initials avatar - "EK", "MA" - as the canvases render people. */
export function Avatar({ initials, label }: { initials: string; label?: string }): ReactElement {
  return (
    <span
      {...(label !== undefined ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill ' +
        'bg-teal-tint text-xs font-semibold text-teal'
      }
    >
      {initials}
    </span>
  );
}

/** Leading avatar/icon, content, trailing meta - the list unit everywhere. */
export function ListRow({
  leading,
  trailing,
  children,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center gap-3 border-b border-hairline py-3 last:border-b-0">
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing !== undefined ? (
        <div className="shrink-0 text-xs text-muted">{trailing}</div>
      ) : null}
    </div>
  );
}
