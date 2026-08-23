import type { ReactElement, ReactNode } from 'react';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <section
      className={`rounded-card border border-black/5 bg-surface p-5 shadow-resting ${className ?? ''}`.trim()}
    >
      {children}
    </section>
  );
}

/** Header row: title left, optional action link right ("All alerts"). */
export function CardHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <header className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
      {action !== undefined ? <span className="text-sm">{action}</span> : null}
    </header>
  );
}
