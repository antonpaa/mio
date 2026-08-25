import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, EmptyState, ErrorState, Skeleton, StatusChip } from '@mio/ui';
import { auditQueryFor, auditSearch, type AuditEvent, type AuditFilters } from './api.js';
import { useSession } from '../session/session.js';

/**
 * A3, X4-minimised: who viewed or changed what, when. Staff actors by
 * name, PATIENTS AS INITIALS, and the event text is composed from two
 * bounded vocabularies (verb + resource) with the raw key as fallback -
 * nothing clinical has a way in, because the audit rows never carry it.
 */

const field = 'mt-1 rounded-inner border border-border bg-surface px-3 py-1.5 text-sm text-ink';

export function AdminAuditPage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [exporting, setExporting] = useState(false);
  const audit = useQuery(auditQueryFor(filters));

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      const response = await fetch(`/api/admin/audit/export?${auditSearch(filters)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`export: ${response.status}`);
      const { csv } = (await response.json()) as { csv: string };
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `mio-audit-${filters.from ?? 'recent'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };
  // P2: the auditor sees full names, so the lede must say so - the
  // initials promise belongs to the (historical) admin rendering only
  const auditor = session.realm === 'staff' && (session.account?.roles ?? []).includes('auditor');

  // Only the FIRST paint blanks. Once the controls exist, a refetch
  // under a changed filter swaps the table alone - a filter bar that
  // unmounts as you use it throws focus away mid-keystroke.
  if (audit.isPending && audit.data === undefined && !audit.isError) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const label = (id: string, fallback: string): string => {
    const text = intl.formatMessage({ id });
    return text === id ? fallback.replaceAll('_', ' ') : text;
  };
  const eventText = (event: AuditEvent): string => {
    const verb = event.action.includes('.')
      ? event.action.slice(event.action.indexOf('.') + 1)
      : event.action;
    return `${label(`admin.verb.${verb}`, verb)} — ${label(
      `admin.res.${event.resource_type}`,
      event.resource_type,
    )}`;
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="nav.audit" />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id={auditor ? 'admin.auditLedeAuditor' : 'admin.auditLede'} />
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
        <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-muted">
          <FormattedMessage id="admin.auditFrom" />
          <input
            type="date"
            className={field}
            value={filters.from ?? audit.data?.range.from ?? ''}
            onChange={(event) => setFilters({ ...filters, from: event.currentTarget.value })}
          />
        </label>
        <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-muted">
          <FormattedMessage id="admin.auditTo" />
          <input
            type="date"
            className={field}
            value={filters.to ?? audit.data?.range.to ?? ''}
            onChange={(event) => setFilters({ ...filters, to: event.currentTarget.value })}
          />
        </label>
        <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-muted">
          <FormattedMessage id="admin.auditEvent" />
          <select
            className={field}
            value={filters.action ?? ''}
            onChange={(event) => setFilters({ ...filters, action: event.currentTarget.value })}
          >
            <option value="">{intl.formatMessage({ id: 'admin.auditAny' })}</option>
            {(audit.data?.filters.actions ?? []).map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-muted">
          <FormattedMessage id="admin.auditActor" />
          <select
            className={field}
            value={filters.actor ?? ''}
            onChange={(event) => setFilters({ ...filters, actor: event.currentTarget.value })}
          >
            <option value="">{intl.formatMessage({ id: 'admin.auditAny' })}</option>
            {(audit.data?.filters.actors ?? []).map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="quiet" size="sm" onPress={() => setFilters({})}>
            <FormattedMessage id="admin.auditClear" />
          </Button>
          <Button size="sm" isDisabled={exporting} onPress={() => void exportCsv()}>
            <FormattedMessage id="admin.auditExport" />
          </Button>
        </div>
      </div>
      {audit.isError ? (
        <ErrorState onRetry={() => void audit.refetch()} />
      ) : audit.data === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : audit.data.events.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'admin.auditEmpty' })}>
          <FormattedMessage id="admin.auditEmptyBody" />
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-card border border-black/5 bg-surface shadow-resting">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3 font-medium">
                  <FormattedMessage id="admin.colWhen" />
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  <FormattedMessage id="admin.colWho" />
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  <FormattedMessage id="admin.colEvent" />
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  <FormattedMessage id="admin.colSubject" />
                </th>
              </tr>
            </thead>
            <tbody>
              {audit.data.events.map((event, index) => (
                <tr key={index} className="border-b border-border/60 last:border-b-0 align-top">
                  <td className="whitespace-nowrap px-5 py-2 text-secondary">
                    {intl.formatDate(event.occurred_at, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: 'numeric',
                    })}
                  </td>
                  <td className="px-3 py-2 text-ink">
                    {event.actor_realm === 'system' ? (
                      <FormattedMessage id="admin.actorSystem" />
                    ) : (
                      event.actor
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink">
                    <span className="flex flex-wrap items-center gap-2">
                      {eventText(event)}
                      {event.decision === 'deny' ? (
                        <StatusChip tone="red">
                          {intl.formatMessage({ id: 'admin.denied' })}
                        </StatusChip>
                      ) : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-secondary">
                    {event.subject !== null ? (
                      intl.formatMessage(
                        { id: 'admin.subjectPatient' },
                        { initials: event.subject },
                      )
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
