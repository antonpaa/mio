import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { EmptyState, ErrorState, Skeleton, StatusChip } from '@mio/ui';
import { auditQuery, type AuditEvent } from './api.js';
import { useSession } from '../session/session.js';

/**
 * A3, X4-minimised: who viewed or changed what, when. Staff actors by
 * name, PATIENTS AS INITIALS, and the event text is composed from two
 * bounded vocabularies (verb + resource) with the raw key as fallback -
 * nothing clinical has a way in, because the audit rows never carry it.
 */

export function AdminAuditPage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const audit = useQuery(auditQuery);
  // P2: the auditor sees full names, so the lede must say so - the
  // initials promise belongs to the (historical) admin rendering only
  const auditor = session.realm === 'staff' && session.account?.role === 'auditor';

  if (audit.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (audit.isError) return <ErrorState onRetry={() => void audit.refetch()} />;

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
      {audit.data.events.length === 0 ? (
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
