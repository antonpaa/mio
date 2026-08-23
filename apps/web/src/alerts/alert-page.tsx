import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
import { Button, ConfirmDialog, ErrorState, SeverityChip, Skeleton, StatusChip } from '@mio/ui';
import { ALERT_STATUS_TONE, type AlertDetail, type TriggerCitation } from './alert-model.js';

/**
 * PP6: the alert detail - severity, the triggers that fired with their
 * cited answers, the workflow controls (acknowledge / assign / resolve)
 * and the audited history timeline assembled from workflow state and
 * append-only comments. Resolution is terminal, so it confirms.
 */

function citationText(intl: IntlShape, citation: TriggerCitation): string {
  const regionNames = (citation.regions ?? [])
    .map((region) => intl.formatMessage({ id: `bodymap.region.${region}` }))
    .join(', ');
  switch (citation.kind) {
    case 'option':
      return intl.formatMessage(
        { id: 'alerts.citation.option' },
        { label: citation.questionLabel, value: citation.valueLabel ?? '' },
      );
    case 'at_least':
    case 'at_most':
      return intl.formatMessage(
        { id: `alerts.citation.${citation.kind}` },
        {
          label: citation.questionLabel,
          observed: String(citation.observed ?? ''),
          threshold: citation.threshold ?? 0,
        },
      );
    case 'critical_region':
      return intl.formatMessage(
        { id: 'alerts.citation.critical' },
        { label: citation.questionLabel, regions: regionNames },
      );
    case 'other_region':
      return intl.formatMessage(
        { id: 'alerts.citation.other' },
        { label: citation.questionLabel, regions: regionNames },
      );
    case 'region_count':
      return intl.formatMessage(
        { id: 'alerts.citation.count' },
        {
          label: citation.questionLabel,
          count: citation.regions?.length ?? 0,
          regions: regionNames,
        },
      );
  }
}

interface TimelineEntry {
  key: string;
  at: string;
  text: string;
  body?: string;
}

function buildTimeline(intl: IntlShape, detail: AlertDetail): TimelineEntry[] {
  const { alert, comments } = detail;
  const entries: TimelineEntry[] = [
    {
      key: 'raised',
      at: alert.created_at,
      text: intl.formatMessage(
        { id: 'alerts.timeline.raised' },
        { count: detail.triggers.filter((t) => t.severity !== null).length },
      ),
    },
  ];
  if (alert.acknowledged_at !== null) {
    entries.push({
      key: 'acknowledged',
      at: alert.acknowledged_at,
      text: intl.formatMessage(
        { id: 'alerts.timeline.acknowledged' },
        { name: `${alert.acknowledged_given ?? ''} ${alert.acknowledged_family ?? ''}`.trim() },
      ),
    });
  }
  if (alert.assigned_at !== null) {
    entries.push({
      key: 'assigned',
      at: alert.assigned_at,
      text: intl.formatMessage(
        { id: 'alerts.timeline.assigned' },
        {
          name: `${alert.assignee_given ?? ''} ${alert.assignee_family ?? ''}`.trim(),
          by: `${alert.assigned_by_given ?? ''} ${alert.assigned_by_family ?? ''}`.trim(),
        },
      ),
    });
  }
  for (const comment of comments) {
    entries.push({
      key: `comment-${comment.id}`,
      at: comment.created_at,
      text: intl.formatMessage(
        { id: 'alerts.timeline.comment' },
        { name: `${comment.author_given} ${comment.author_family}` },
      ),
      body: comment.body,
    });
  }
  if (alert.resolved_at !== null) {
    entries.push({
      key: 'resolved',
      at: alert.resolved_at,
      text: intl.formatMessage(
        { id: 'alerts.timeline.resolved' },
        { name: `${alert.resolved_given ?? ''} ${alert.resolved_family ?? ''}`.trim() },
      ),
    });
  }
  return entries.sort((a, b) => (a.at < b.at ? -1 : 1));
}

export function AlertPage(): ReactElement {
  const { alertId } = useParams({ strict: false }) as { alertId: string };
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState('');
  const [comment, setComment] = useState('');
  const [confirmResolve, setConfirmResolve] = useState(false);

  const detail = useQuery({
    queryKey: ['alerts', alertId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/alerts/${alertId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`alert: ${response.status}`);
      return (await response.json()) as AlertDetail;
    },
    retry: false,
  });

  const act = useMutation({
    mutationFn: async (input: {
      verb: 'acknowledge' | 'resolve' | 'assign' | 'comments';
      body?: object;
    }) => {
      const response = await fetch(`/api/staff/alerts/${alertId}/${input.verb}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(input.body ?? {}),
      });
      if (!response.ok) throw new Error(`${input.verb}: ${response.status}`);
    },
    onSuccess: async () => {
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;

  const { alert, triggers, team } = detail.data;
  const open = alert.status !== 'resolved';
  const timeline = buildTimeline(intl, detail.data);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <SeverityChip
          severity={alert.severity}
          label={intl.formatMessage({ id: `severity.${alert.severity}` })}
        />
        <h1 className="font-display text-2xl italic text-ink">
          <Link
            to="/patients/$patientId"
            params={{ patientId: alert.patient_id }}
            className="underline-offset-4 hover:underline"
          >
            {alert.patient_given} {alert.patient_family}
          </Link>
        </h1>
        <StatusChip tone={ALERT_STATUS_TONE[alert.status]}>
          {intl.formatMessage({ id: `alerts.status.${alert.status}` })}
        </StatusChip>
        <div className="ml-auto flex gap-2">
          {open && alert.acknowledged_at === null ? (
            <Button
              size="sm"
              isDisabled={act.isPending}
              onPress={() => act.mutate({ verb: 'acknowledge' })}
            >
              <FormattedMessage id="alerts.acknowledge" />
            </Button>
          ) : null}
          {open ? (
            <Button
              variant="quiet"
              size="sm"
              isDisabled={act.isPending}
              onPress={() => setConfirmResolve(true)}
            >
              <FormattedMessage id="alerts.resolve" />
            </Button>
          ) : null}
        </div>
      </header>
      <p className="text-sm text-secondary">
        {alert.survey_name !== null ? (
          <FormattedMessage
            id="alerts.source"
            values={{
              survey: alert.survey_name,
              at: intl.formatDate(alert.submitted_at ?? alert.created_at, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            }}
          />
        ) : (
          alert.treatment_name
        )}
      </p>

      <section
        aria-labelledby="triggers-title"
        className="rounded-card border border-black/5 bg-surface p-5 shadow-resting"
      >
        <h2 id="triggers-title" className="text-xs font-medium uppercase tracking-wide text-muted">
          <FormattedMessage id="alerts.triggers" />
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {triggers.map((trigger) => (
            <li key={trigger.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <span className="flex min-w-28 shrink-0">
                {trigger.severity !== null ? (
                  <SeverityChip
                    severity={trigger.severity}
                    label={intl.formatMessage({ id: `severity.${trigger.severity}` })}
                  />
                ) : (
                  <StatusChip tone="neutral">
                    {intl.formatMessage({ id: 'alerts.recordOnly' })}
                  </StatusChip>
                )}
              </span>
              <span>{citationText(intl, trigger.citation)}</span>
            </li>
          ))}
        </ul>
      </section>

      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-ink-strong-secondary" htmlFor="assign-select">
            <FormattedMessage id="alerts.assignTo" />
          </label>
          <select
            id="assign-select"
            className="rounded-inner border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
            value={assigning !== '' ? assigning : (alert.assignee_id ?? '')}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setAssigning(next);
              if (next !== '') act.mutate({ verb: 'assign', body: { assigneeId: next } });
            }}
          >
            <option value="">{intl.formatMessage({ id: 'alerts.unassigned' })}</option>
            {team.map((entry) => (
              <option key={entry.staff_id} value={entry.staff_id}>
                {entry.given_name} {entry.family_name}
                {entry.is_lead ? ` · ${intl.formatMessage({ id: 'treatment.lead' })}` : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <section
        aria-labelledby="timeline-title"
        className="rounded-card border border-black/5 bg-surface p-5 shadow-resting"
      >
        <h2 id="timeline-title" className="text-xs font-medium uppercase tracking-wide text-muted">
          <FormattedMessage id="alerts.timeline" />
        </h2>
        <ol className="mt-3 flex flex-col gap-3 border-l-2 border-hairline pl-4">
          {timeline.map((entry) => (
            <li key={entry.key} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-pill bg-teal"
              />
              <p className="text-sm text-ink">{entry.text}</p>
              {entry.body !== undefined ? (
                <p className="mt-0.5 rounded-inner bg-surface-sunken px-3 py-2 text-sm text-ink">
                  {entry.body}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-muted">
                {intl.formatDate(entry.at, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </li>
          ))}
        </ol>
        <form
          className="mt-4 flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim() !== '') act.mutate({ verb: 'comments', body: { body: comment } });
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-inner border border-border bg-surface px-3 py-2 text-sm text-ink"
            aria-label={intl.formatMessage({ id: 'alerts.comment' })}
            placeholder={intl.formatMessage({ id: 'alerts.commentPlaceholder' })}
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
          />
          <Button size="sm" type="submit" isDisabled={comment.trim() === '' || act.isPending}>
            <FormattedMessage id="alerts.commentSend" />
          </Button>
        </form>
      </section>

      {confirmResolve ? (
        <ConfirmDialog
          title={intl.formatMessage({ id: 'alerts.confirmResolve.title' })}
          cancelLabel={intl.formatMessage({ id: 'confirm.keep' })}
          confirmLabel={intl.formatMessage({ id: 'alerts.resolve' })}
          busy={act.isPending}
          onCancel={() => setConfirmResolve(false)}
          onConfirm={() =>
            act.mutate({ verb: 'resolve' }, { onSettled: () => setConfirmResolve(false) })
          }
        >
          <FormattedMessage id="alerts.confirmResolve.body" />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
