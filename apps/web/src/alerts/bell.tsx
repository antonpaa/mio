import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';
import { TRIAGE_QUERY } from './alert-model.js';

/**
 * The notification bell (WP-19 slice): NEW alerts across the clinician's
 * care patients. Shares the triage query with the dashboard card - one
 * audited disclosure serves both. Full notification centre lands with
 * WP-25; until then the bell IS the alert entry point.
 */
export function AlertBell(): ReactElement {
  const intl = useIntl();
  const triage = useQuery(TRIAGE_QUERY);
  const fresh = (triage.data ?? []).filter((row) => row.status === 'new').length;

  return (
    <Link
      to="/"
      aria-label={intl.formatMessage({ id: 'alerts.bellLabel' }, { count: fresh })}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-pill text-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.86 17.08a24 24 0 0 0 5.45-1.3 8.97 8.97 0 0 1-2.31-6.02V9a6 6 0 1 0-12 0v.75a8.97 8.97 0 0 1-2.31 6.02 24 24 0 0 0 5.45 1.3m5.72 0a24.3 24.3 0 0 1-5.72 0m5.72 0a3 3 0 1 1-5.72 0"
        />
      </svg>
      {fresh > 0 ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-red px-1 text-[10px] font-semibold leading-none text-surface"
        >
          {fresh > 9 ? '9+' : fresh}
        </span>
      ) : null}
    </Link>
  );
}
