import type { ReactElement, ReactNode } from 'react';
import { MioMark } from './logo.js';

export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
  /** Unread count badge; rendered with an accessible name by the caller's label. */
  badge?: number;
}

export interface AppShellProps {
  /** 'patient' | 'clinician' render identically; 'admin' adds the masthead word. */
  variant: 'patient' | 'clinician' | 'admin';
  items: NavItem[];
  /** Right-hand chunk: bell, avatar, sign-out - composed by the app. */
  end?: ReactNode;
  /** Renders item labels as links; the app supplies its router's Link. */
  renderLink: (item: NavItem, className: string) => ReactNode;
  /** Localized "main navigation" label. */
  navLabel: string;
  children: ReactNode;
}

/**
 * The shared shell (docs/design/screen-inventory.md): brand left, PRIMARY
 * NAVIGATION ON TOP, CENTERED (a brief-level requirement), end slot right.
 * Dumb on purpose - routing, badges and menus belong to the apps.
 */
export function AppShell({
  variant,
  items,
  end,
  renderLink,
  navLabel,
  children,
}: AppShellProps): ReactElement {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <span className="flex items-center gap-2">
            <MioMark size={32} />
            {variant === 'admin' ? (
              <span className="text-sm font-medium text-ink-strong-secondary">Administration</span>
            ) : null}
          </span>
          <nav aria-label={navLabel} className="flex-1">
            <ul className="flex items-center justify-center gap-1">
              {items.map((item) => (
                <li key={item.href}>
                  {renderLink(
                    item,
                    'inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-sm ' +
                      'transition-colors hover:bg-teal-tint ' +
                      (item.active === true
                        ? 'bg-teal-tint font-semibold text-teal'
                        : 'font-medium text-ink-strong-secondary'),
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2">{end}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

/** Unread-count badge for nav items and the bell. */
export function CountBadge({ count, label }: { count: number; label: string }): ReactElement {
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-teal px-1 text-[10px] font-semibold text-surface"
    >
      {count}
    </span>
  );
}
