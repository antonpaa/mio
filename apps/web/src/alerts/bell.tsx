import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';
import { IconBell } from '@mio/ui';
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
      <IconBell size={20} />
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
