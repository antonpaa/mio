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

/** Header row: title left (with an optional decorative leading icon in
 * teal - the print-registration set from icons.tsx), optional action
 * link right ("All alerts"). */
export function CardHeader({
  title,
  action,
  icon,
}: {
  title: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}): ReactElement {
  return (
    <header className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-ink">
        {icon !== undefined ? <span className="text-teal">{icon}</span> : null}
        {title}
      </h2>
      {action !== undefined ? <span className="text-sm">{action}</span> : null}
    </header>
  );
}
