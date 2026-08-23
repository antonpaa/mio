import type { ReactElement, ReactNode } from 'react';
import { MioMark } from './logo.js';

/**
 * Empty state (S1): the mark, a Newsreader italic line, calm explanation,
 * at most one action. Empty states define the personality of a dignified
 * UI as much as the happy paths - the brief says so explicitly.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-black/5 bg-surface px-6 py-9 text-center shadow-resting">
      <MioMark size={44} />
      <p className="font-display text-lg italic text-ink">{title}</p>
      {children !== undefined ? (
        <p className="max-w-64 text-sm leading-relaxed text-secondary">{children}</p>
      ) : null}
      {action}
    </div>
  );
}

/**
 * Error state (S1/C6): honest about what happened, explicit that nothing
 * was lost, one retry action. Never a blameless-passive shrug.
 */
export function ErrorState({
  title = "Couldn't load this right now",
  detail = "Your connection or our service hiccupped. Nothing you've done was lost.",
  onRetry,
  retryLabel = 'Try again',
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}): ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-red-chip-border bg-red-tint-soft px-6 py-9 text-center"
    >
      <p className="font-display text-lg italic text-ink">{title}</p>
      <p className="max-w-64 text-sm leading-relaxed text-secondary">{detail}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-pill border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-teal-tint"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Shimmer skeleton (S6). Purely decorative - hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={
        'block animate-shimmer rounded-inner ' +
        'bg-[linear-gradient(90deg,var(--color-surface-sunken)_25%,var(--color-hairline)_50%,var(--color-surface-sunken)_75%)] ' +
        'bg-[length:200%_100%] ' +
        (className ?? 'h-4 w-full')
      }
    />
  );
}

/** The breathing launch splash (L0/S6). */
export function Splash({
  message = 'Opening your care space…',
}: {
  message?: string;
}): ReactElement {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper">
      <div className="animate-breathe motion-reduce:animate-none">
        <MioMark size={64} />
      </div>
      <p className="font-display text-xl italic text-ink">mio</p>
      <p role="status" className="text-sm text-secondary">
        {message}
      </p>
    </div>
  );
}
