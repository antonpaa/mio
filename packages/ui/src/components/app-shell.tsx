import { useState, type ReactElement, type ReactNode } from 'react';
import { MioMark } from './logo.js';

export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
  /** Unread count badge; rendered with an accessible name by the caller's label. */
  badge?: number;
  /** Decorative leading icon (aria-hidden by construction); the label names the item. */
  icon?: ReactNode;
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
  /** Localized toggle label for the mobile menu button. */
  menuLabel: string;
  children: ReactNode;
}

/**
 * The shared shell (docs/design/screen-inventory.md): brand left, PRIMARY
 * NAVIGATION ON TOP, CENTERED (a brief-level requirement), end slot right.
 * Below md the nav collapses behind a menu button - the design's mobile
 * menu, which also hosts the end slot (avatar, sign out). Dumb on purpose:
 * routing, badges and menus belong to the apps.
 */
export function AppShell({
  variant,
  items,
  end,
  renderLink,
  navLabel,
  menuLabel,
  children,
}: AppShellProps): ReactElement {
  const [open, setOpen] = useState(false);

  const linkClass = (item: NavItem, block: boolean): string =>
    (block
      ? 'flex items-center gap-1.5 rounded-inner px-3.5 py-2.5 text-sm '
      : 'inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-sm ') +
    'transition-colors hover:bg-teal-tint ' +
    (item.active === true
      ? 'bg-teal-tint font-semibold text-teal'
      : 'font-medium text-ink-strong-secondary');

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
          <nav aria-label={navLabel} className="hidden flex-1 md:block">
            <ul className="flex items-center justify-center gap-1">
              {items.map((item) => (
                <li key={item.href}>{renderLink(item, linkClass(item, false))}</li>
              ))}
            </ul>
          </nav>
          <div className="hidden items-center gap-2 md:flex">{end}</div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mio-mobile-menu"
            onClick={() => setOpen((current) => !current)}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-inner border border-border text-ink transition-colors hover:bg-teal-tint md:hidden"
          >
            <span className="sr-only">{menuLabel}</span>
            <svg viewBox="0 0 20 20" aria-hidden width={18} height={18} fill="none">
              {open ? (
                <path
                  d="m5 5 10 10M15 5 5 15"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3 5.5h14M3 10h14M3 14.5h14"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
        <div
          id="mio-mobile-menu"
          hidden={!open}
          className="border-t border-hairline px-4 pb-4 pt-2 md:hidden"
        >
          {/* Its own landmark name - two nav landmarks may share the tree
              (CSS hides one), and landmarks must stay uniquely labelled. */}
          <nav aria-label={menuLabel}>
            <ul className="flex flex-col gap-0.5" onClick={() => setOpen(false)}>
              {items.map((item) => (
                <li key={item.href}>{renderLink(item, linkClass(item, true))}</li>
              ))}
            </ul>
          </nav>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
            {end}
          </div>
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
