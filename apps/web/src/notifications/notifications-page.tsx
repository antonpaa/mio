import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, ErrorState, IconMessages, IconSymptoms, Skeleton } from '@mio/ui';
import { useLocaleControls } from '../app/locale-context.js';
import { NOTIFICATIONS_QUERY, type NotificationItem } from './model.js';

/**
 * P11: the in-app notification centre - the CONTENT-BEARING layer. A
 * rule-authored note renders its text in the reader's language; a new
 * message renders a reference and links into the thread. The page also
 * says out loud what email does NOT carry, per the design's voice.
 */

function itemText(item: NotificationItem, locale: string): string | null {
  if (item.body === null) return null;
  return item.body[locale] ?? item.body['en'] ?? Object.values(item.body)[0] ?? null;
}

export function NotificationsPage(): ReactElement {
  const intl = useIntl();
  const { locale } = useLocaleControls();
  const queryClient = useQueryClient();
  const payload = useQuery(NOTIFICATIONS_QUERY);

  const markRead = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/patient/notifications/read', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`read: ${response.status}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (payload.isPending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (payload.isError) return <ErrorState onRetry={() => void payload.refetch()} />;

  const { items, unread } = payload.data;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="notifications.title" />
        </h1>
        {unread > 0 ? (
          <Button
            size="sm"
            variant="quiet"
            onPress={() => markRead.mutate()}
            isDisabled={markRead.isPending}
          >
            <FormattedMessage id="notifications.markAllRead" />
          </Button>
        ) : null}
      </header>
      <p className="text-sm text-secondary">
        <FormattedMessage id="notifications.emailExplainer" />
      </p>

      <section className="rounded-card border border-black/5 bg-surface shadow-resting">
        {items.length === 0 ? (
          <p className="px-5 py-5 text-sm text-secondary">
            <FormattedMessage id="notifications.empty" />
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((item) => {
              const fresh = item.read_at === null;
              const text = itemText(item, locale);
              const row = (
                <span className="flex items-start gap-3">
                  <span className={`mt-0.5 ${fresh ? 'text-teal' : 'text-muted'}`}>
                    {item.kind === 'message.new' ? (
                      <IconMessages size={18} />
                    ) : (
                      <IconSymptoms size={18} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm ${fresh ? 'font-semibold text-ink' : 'text-ink-strong-secondary'}`}
                    >
                      {item.kind === 'message.new' ? (
                        <FormattedMessage
                          id="notifications.newMessage"
                          values={{ treatment: item.treatment_name ?? '' }}
                        />
                      ) : (
                        <FormattedMessage id="notifications.careTeamNote" />
                      )}
                    </span>
                    {text !== null ? (
                      <span className="block text-sm text-secondary">{text}</span>
                    ) : null}
                    <span className="mt-0.5 block text-xs text-muted">
                      {intl.formatDate(item.created_at, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </span>
                  {fresh ? (
                    <>
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-teal" />
                      <span className="sr-only">
                        {intl.formatMessage({ id: 'notifications.unreadDot' })}
                      </span>
                    </>
                  ) : null}
                </span>
              );
              return (
                <li key={item.id} className="px-5 py-3.5">
                  {item.kind === 'message.new' && item.ref.treatmentId !== undefined ? (
                    <Link
                      to="/messages/$treatmentId"
                      params={{ treatmentId: item.ref.treatmentId }}
                      className="block rounded-inner transition-colors hover:bg-surface-sunken"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
