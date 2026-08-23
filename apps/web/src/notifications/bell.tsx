import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';
import { IconBell } from '@mio/ui';
import { NOTIFICATIONS_QUERY } from './model.js';

/** The patient bell (P11 entry point): unread count over the same
 * audited disclosure the centre page makes. */
export function NotificationBell(): ReactElement {
  const intl = useIntl();
  const payload = useQuery(NOTIFICATIONS_QUERY);
  const unread = payload.data?.unread ?? 0;

  return (
    <Link
      to="/notifications"
      aria-label={intl.formatMessage({ id: 'notifications.bellLabel' }, { count: unread })}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-pill text-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <IconBell size={20} />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-teal px-1 text-[10px] font-semibold leading-none text-surface"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
