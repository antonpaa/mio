import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, ErrorState, IconMessages, IconSymptoms, Skeleton } from '@mio/ui';
import { useLocaleControls } from '../app/locale-context.js';
import { notificationsQuery, type NotificationItem, type NotificationRealm } from './model.js';

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

export function NotificationsPage({
  realm = 'patient',
}: {
  realm?: NotificationRealm;
} = {}): ReactElement {
  const intl = useIntl();
  const { locale } = useLocaleControls();
  const queryClient = useQueryClient();
  const payload = useQuery(notificationsQuery(realm));

  const markRead = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/${realm}/notifications/read`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`read: ${response.status}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications', realm] }),
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
  const todayKey = new Date().toDateString();
  const groups = [
    {
      id: 'notifications.groupToday',
      items: items.filter((item) => new Date(item.created_at).toDateString() === todayKey),
    },
    {
      id: 'notifications.groupEarlier',
      items: items.filter((item) => new Date(item.created_at).toDateString() !== todayKey),
    },
  ].filter((group) => group.items.length > 0);
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
        <FormattedMessage
          id={realm === 'staff' ? 'notifications.staffLede' : 'notifications.emailExplainer'}
        />
      </p>

      {items.length === 0 ? (
        <section className="rounded-card border border-black/5 bg-surface shadow-resting">
          <p className="px-5 py-5 text-sm text-secondary">
            <FormattedMessage id="notifications.empty" />
          </p>
        </section>
      ) : (
        /* the canvas splits the centre into Today and Earlier */
        groups.map((group) => (
          <section key={group.id} aria-label={intl.formatMessage({ id: group.id })}>
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <FormattedMessage id={group.id} />
            </h2>
            <div className="rounded-card border border-black/5 bg-surface shadow-resting">
              <ul className="divide-y divide-hairline">
                {group.items.map((item) => {
                  const fresh = item.read_at === null;
                  const text = itemText(item, locale);
                  const row = (
                    <span className="flex items-start gap-3">
                      {/* the canvas's circled icon tile - tinted while unread */}
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-pill ${
                          fresh ? 'bg-teal-tint text-teal' : 'bg-surface-sunken text-muted'
                        }`}
                      >
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
                          ) : realm === 'staff' ? (
                            <FormattedMessage id="notifications.ruleNote" />
                          ) : (
                            <FormattedMessage id="notifications.careTeamNote" />
                          )}
                        </span>
                        {realm === 'staff' && item.patient_given !== undefined ? (
                          <span className="block text-xs text-muted">
                            <FormattedMessage
                              id="notifications.aboutPatient"
                              values={{
                                patient:
                                  `${item.patient_given} ${item.patient_family ?? ''}`.trim(),
                                program: item.treatment_name ?? '',
                              }}
                            />
                          </span>
                        ) : null}
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
                          <span
                            aria-hidden
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-teal"
                          />
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
            </div>
          </section>
        ))
      )}
    </div>
  );
}
