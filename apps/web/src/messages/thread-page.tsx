import { Fragment, useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FormattedMessage, useIntl } from 'react-intl';
import type { MessageDoc } from '@mio/contracts';
import { Avatar, ErrorState, Skeleton } from '@mio/ui';
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
  | {
      kind: 'alert';
      id: string;
      severity: 'low' | 'moderate' | 'high';
      status: string;
      created_at: string;
      survey_name: string | null;
    };

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
      {/* C4's thread header: avatar, patient, programme and the shared-
          inbox lede, with the profile as a proper action on the right */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {realm === 'staff' ? (
            <Avatar
              initials={`${detail.treatment.patient_given?.[0] ?? ''}${detail.treatment.patient_family?.[0] ?? ''}`}
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h1 className="font-display text-2xl italic text-ink">
                {realm === 'staff'
                  ? `${detail.treatment.patient_given ?? ''} ${detail.treatment.patient_family ?? ''}`
                  : detail.treatment.name}
              </h1>
              {realm === 'staff' ? (
                <span className="text-sm text-secondary">{detail.treatment.name}</span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm text-secondary">
              <FormattedMessage
                id={realm === 'staff' ? 'messages.sharedInboxLede' : 'messages.expectation'}
              />
            </p>
          </div>
        </div>
        {realm === 'staff' && detail.treatment.patient_id !== undefined ? (
          <Link
            to="/patients/$patientId"
            params={{ patientId: detail.treatment.patient_id }}
            className="shrink-0 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-sunken"
          >
            <FormattedMessage id="messages.openProfile" />
          </Link>
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
            {markers.map((marker, index) => {
              // C4's day separators: a quiet centered chip whenever the
              // timeline crosses into a new day
              const dayOf = (entry: Marker): string =>
                (entry.kind === 'item' ? entry.item.created_at : entry.created_at).slice(0, 10);
              const day = dayOf(marker);
              const separator =
                index === 0 || dayOf(markers[index - 1]!) !== day ? (
                  <li key={`day-${day}`} className="flex justify-center">
                    <span className="rounded-pill bg-surface-sunken px-3 py-1 text-xs text-secondary">
                      {intl.formatDate(`${day}T12:00:00`, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </span>
                  </li>
                ) : null;
              if (marker.kind === 'alert') {
                const tone =
                  marker.severity === 'high'
                    ? 'border-red-chip-border bg-red-tint text-red'
                    : marker.severity === 'moderate'
                      ? 'border-amber-chip-border bg-amber-tint text-amber'
                      : 'border-teal-chip-border bg-teal-tint text-teal';
                return (
                  <Fragment key={`alert-${marker.id}`}>
                    {separator}
                    <li className="flex justify-center">
                      {/* the canvas's in-stream alert chip - the whole pill
                          opens the PP6 detail */}
                      <Link
                        to="/alerts/$alertId"
                        params={{ alertId: marker.id }}
                        className={`rounded-pill border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${tone}`}
                      >
                        {marker.survey_name !== null && marker.survey_name !== undefined
                          ? intl.formatMessage(
                              { id: 'messages.alertFrom' },
                              {
                                severity: intl.formatMessage({
                                  id: `severity.${marker.severity}`,
                                }),
                                survey: marker.survey_name,
                              },
                            )
                          : intl.formatMessage({ id: 'messages.alertMarker' })}
                        {' — '}
                        {intl.formatTime(marker.created_at, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Link>
                    </li>
                  </Fragment>
                );
              }
              const item = marker.item;
              const own = item.author_id === myId;
              if (item.kind === 'note') {
                return (
                  <Fragment key={item.id}>
                    {separator}
                    <li className="flex justify-end">
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
                          <MessageDocView
                            doc={item.body}
                            attachmentBase={
                              realm === 'staff'
                                ? '/api/staff/attachments'
                                : '/api/patient/attachments'
                            }
                            attachmentAlt={intl.formatMessage({ id: 'messages.attachmentAlt' })}
                          />
                        </div>
                      </div>
                    </li>
                  </Fragment>
                );
              }
              // P6's bubble language: your own messages are solid teal
              // with the timestamp tucked below; the other party gets an
              // avatar and a name-and-time line under their bubble.
              const authorName = `${item.author_given ?? ''} ${item.author_family ?? ''}`.trim();
              const stamp = intl.formatDate(item.created_at, {
                dateStyle: 'medium',
                timeStyle: 'short',
              });
              return (
                <Fragment key={item.id}>
                  {separator}
                  <li className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                    {own ? (
                      <div className="flex max-w-[85%] flex-col items-end">
                        <div className="rounded-card bg-teal px-4 py-2.5 text-white">
                          <MessageDocView
                            doc={item.body}
                            attachmentBase={
                              realm === 'staff'
                                ? '/api/staff/attachments'
                                : '/api/patient/attachments'
                            }
                            attachmentAlt={intl.formatMessage({ id: 'messages.attachmentAlt' })}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted">{stamp}</p>
                      </div>
                    ) : (
                      <div className="flex max-w-[85%] items-end gap-2">
                        <Avatar
                          initials={`${item.author_given?.[0] ?? ''}${item.author_family?.[0] ?? ''}`}
                          label={authorName}
                        />
                        <div className="flex min-w-0 flex-col items-start">
                          <div className="rounded-card bg-surface-sunken px-4 py-2.5">
                            <MessageDocView
                              doc={item.body}
                              attachmentBase={
                                realm === 'staff'
                                  ? '/api/staff/attachments'
                                  : '/api/patient/attachments'
                              }
                              attachmentAlt={intl.formatMessage({ id: 'messages.attachmentAlt' })}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {authorName} — {stamp}
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                </Fragment>
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
            draftKey={`${myId}:${treatmentId}:${realm === 'staff' && lane === 'note' ? 'note' : 'message'}`}
            {...(realm === 'staff' && lane === 'note'
              ? {}
              : {
                  attachmentConfig: {
                    uploadUrl: `/api/${realm}/attachments`,
                    fetchBase: `/api/${realm}/attachments`,
                    treatmentId,
                  },
                })}
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
