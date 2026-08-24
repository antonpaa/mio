import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FormattedMessage, useIntl } from 'react-intl';
import type { MessageDoc } from '@mio/contracts';
import { ErrorState, SeverityChip, Skeleton } from '@mio/ui';
import { useSession } from '../session/session.js';
import { MessageDocView } from './doc-view.js';
import { Composer } from './composer.js';
import { messagesBase, type ThreadDetail, type TimelineItem } from './model.js';

/**
 * P6/P14 and the thread half of C4. The timeline interleaves messages,
 * internal notes (staff only - the API never sends them to a patient)
 * and, for clinicians, the programme's alerts as cross-reference
 * markers. An ended programme reads but does not post. The internal
 * note blocks carry their "not visible to the patient" label as text -
 * visible AND programmatic.
 */

type Marker =
  | { kind: 'item'; item: TimelineItem }
  | { kind: 'alert'; id: string; severity: 'low' | 'moderate' | 'high'; created_at: string };

export function MessageThreadPage(): ReactElement {
  const { treatmentId } = useParams({ strict: false }) as { treatmentId: string };
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const realm = session.realm === 'patient' ? ('patient' as const) : ('staff' as const);
  const myId = session.account?.id ?? '';
  const [lane, setLane] = useState<'reply' | 'note'>('reply');

  const thread = useQuery({
    queryKey: ['message-thread', realm, treatmentId],
    queryFn: async (): Promise<ThreadDetail> => {
      const response = await fetch(`${messagesBase(realm)}/threads/${treatmentId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`thread: ${response.status}`);
      return (await response.json()) as ThreadDetail;
    },
    retry: false,
  });

  // the fetch moved the read watermark server-side - refresh the shared
  // list so the nav badge follows
  useEffect(() => {
    if (thread.isSuccess) {
      void queryClient.invalidateQueries({ queryKey: ['messages', realm] });
    }
  }, [thread.isSuccess, queryClient, realm]);

  const post = useMutation({
    mutationFn: async ({ doc, asNote }: { doc: MessageDoc; asNote: boolean }) => {
      const path = asNote ? 'notes' : 'messages';
      const response = await fetch(`${messagesBase(realm)}/threads/${treatmentId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body: doc }),
      });
      if (!response.ok) throw new Error(`post: ${response.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['message-thread', realm, treatmentId] });
      void queryClient.invalidateQueries({ queryKey: ['messages', realm] });
    },
  });

  if (thread.isPending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (thread.isError) return <ErrorState onRetry={() => void thread.refetch()} />;

  const detail = thread.data;
  const markers: Marker[] = [
    ...detail.items.map((item) => ({ kind: 'item' as const, item })),
    ...(realm === 'staff'
      ? (detail.alerts ?? []).map((alert) => ({ kind: 'alert' as const, ...alert }))
      : []),
  ].sort((a, b) => {
    const at = a.kind === 'item' ? a.item.created_at : a.created_at;
    const bt = b.kind === 'item' ? b.item.created_at : b.created_at;
    return at.localeCompare(bt);
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl italic text-ink">
            {realm === 'staff'
              ? `${detail.treatment.patient_given ?? ''} ${detail.treatment.patient_family ?? ''}`
              : detail.treatment.name}
          </h1>
          {realm === 'staff' ? (
            <span className="text-sm text-secondary">{detail.treatment.name}</span>
          ) : null}
        </div>
        {realm === 'staff' && detail.treatment.patient_id !== undefined ? (
          <p className="mt-1 text-sm">
            <Link
              to="/patients/$patientId"
              params={{ patientId: detail.treatment.patient_id }}
              className="text-teal underline-offset-4 hover:underline"
            >
              <FormattedMessage id="messages.openProfile" />
            </Link>
          </p>
        ) : null}
        {realm === 'patient' ? (
          <p className="mt-1 text-sm text-secondary">
            <FormattedMessage id="messages.expectation" />{' '}
            <span className="text-ink-strong-secondary">
              <FormattedMessage id="messages.emergency" />
            </span>
          </p>
        ) : null}
      </header>

      {detail.readOnly ? (
        <p className="rounded-inner border border-border bg-surface-sunken px-4 py-2.5 text-sm text-ink-strong-secondary">
          <FormattedMessage id="messages.endedBanner" />
        </p>
      ) : null}

      <section
        aria-label={intl.formatMessage({ id: 'nav.messages' })}
        className="rounded-card border border-black/5 bg-surface p-5 shadow-resting"
      >
        {markers.length === 0 ? (
          <p className="text-sm text-secondary">
            <FormattedMessage id="messages.empty" />
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {markers.map((marker) => {
              if (marker.kind === 'alert') {
                return (
                  <li
                    key={`alert-${marker.id}`}
                    className="flex items-center justify-center gap-2 text-xs text-muted"
                  >
                    <SeverityChip
                      severity={marker.severity}
                      label={intl.formatMessage({ id: `severity.${marker.severity}` })}
                    />
                    <FormattedMessage id="messages.alertMarker" />
                    <Link
                      to="/alerts/$alertId"
                      params={{ alertId: marker.id }}
                      className="text-teal underline-offset-4 hover:underline"
                    >
                      <FormattedMessage id="messages.openAlert" />
                    </Link>
                  </li>
                );
              }
              const item = marker.item;
              const own = item.author_id === myId;
              if (item.kind === 'note') {
                return (
                  <li key={item.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-card border border-amber-chip-border bg-amber-tint px-4 py-2.5">
                      <p className="text-xs font-medium text-amber">
                        <FormattedMessage id="messages.internalNote" />
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {item.author_given} {item.author_family}
                        {' — '}
                        {intl.formatDate(item.created_at, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                      <div className="mt-1.5">
                        <MessageDocView doc={item.body} />
                      </div>
                    </div>
                  </li>
                );
              }
              return (
                <li key={item.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-card px-4 py-2.5 ${
                      own ? 'bg-teal-tint' : 'bg-surface-sunken'
                    }`}
                  >
                    <p className="text-xs text-muted">
                      {own ? (
                        <FormattedMessage id="messages.you" />
                      ) : (
                        `${item.author_given ?? ''} ${item.author_family ?? ''}`.trim()
                      )}
                      {' — '}
                      {intl.formatDate(item.created_at, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                    <div className="mt-1">
                      <MessageDocView doc={item.body} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {detail.readOnly ? null : (
        <section aria-label={intl.formatMessage({ id: 'messages.composerRegion' })}>
          {realm === 'staff' ? (
            <div className="mb-2 flex gap-1.5">
              {(['reply', 'note'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={lane === option}
                  onClick={() => setLane(option)}
                  className={`rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${
                    lane === option
                      ? option === 'note'
                        ? 'border-amber-chip-border bg-amber-tint font-medium text-amber'
                        : 'border-teal bg-teal-tint font-medium text-teal'
                      : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
                  }`}
                >
                  {intl.formatMessage({ id: `messages.lane.${option}` })}
                </button>
              ))}
            </div>
          ) : null}
          {realm === 'staff' && lane === 'note' ? (
            <p className="mb-2 text-xs text-amber">
              <FormattedMessage id="messages.internalNote" />
            </p>
          ) : null}
          <Composer
            label={intl.formatMessage({
              id: realm === 'staff' && lane === 'note' ? 'messages.writeNote' : 'messages.write',
            })}
            sendLabel={intl.formatMessage({ id: 'messages.send' })}
            tone={realm === 'staff' && lane === 'note' ? 'note' : 'message'}
            busy={post.isPending}
            onSend={async (doc) => {
              await post.mutateAsync({ doc, asNote: realm === 'staff' && lane === 'note' });
            }}
          />
        </section>
      )}
    </div>
  );
}
