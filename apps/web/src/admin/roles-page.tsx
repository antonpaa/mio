import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { ErrorState, Skeleton } from '@mio/ui';
import { rolesQuery } from './api.js';

/**
 * A2: the role capability matrix, RENDERED FROM the generated
 * capabilities. The screen has no wording of its own to drift from the
 * enforcement - every row is a capability the engine actually grants,
 * grouped by resource, localized through the shared audit vocabulary.
 */

const ROLE_ORDER = ['patient', 'clinician', 'author', 'administrator', 'auditor'] as const;

export function AdminRolesPage(): ReactElement {
  const intl = useIntl();
  const roles = useQuery(rolesQuery);

  if (roles.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (roles.isError) return <ErrorState onRetry={() => void roles.refetch()} />;

  const grants = roles.data.roles;
  const all = new Set<string>(Object.values(grants).flat());
  const byResource = new Map<string, string[]>();
  for (const capability of [...all].sort()) {
    const resource = capability.slice(0, capability.indexOf('.'));
    byResource.set(resource, [...(byResource.get(resource) ?? []), capability]);
  }
  const holds = (role: string, capability: string): boolean =>
    (grants[role] ?? []).includes(capability);
  const label = (id: string, fallback: string): string => {
    const text = intl.formatMessage({ id });
    return text === id ? fallback.replaceAll('_', ' ') : text;
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="nav.roles" />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id="admin.rolesLede" />
        </p>
      </div>
      <div className="overflow-x-auto rounded-card border border-black/5 bg-surface shadow-resting">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-5 py-3 font-medium">
                <FormattedMessage id="admin.colCapability" />
              </th>
              {ROLE_ORDER.map((role) => (
                <th scope="col" key={role} className="px-3 py-3 text-center font-medium">
                  {intl.formatMessage({ id: `admin.role.${role}` })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...byResource.entries()].map(([resource, capabilities]) => (
              <ResourceGroup
                key={resource}
                resource={resource}
                capabilities={capabilities}
                holds={holds}
                label={label}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        <FormattedMessage id="admin.rolesLegend" />
      </p>
    </div>
  );
}

function ResourceGroup({
  resource,
  capabilities,
  holds,
  label,
}: {
  resource: string;
  capabilities: string[];
  holds: (role: string, capability: string) => boolean;
  label: (id: string, fallback: string) => string;
}): ReactElement {
  const intl = useIntl();
  return (
    <>
      <tr className="border-b border-border bg-surface-sunken/50">
        <th
          scope="rowgroup"
          colSpan={6}
          className="px-5 py-2 text-left text-xs font-medium uppercase tracking-wide text-secondary"
        >
          {label(`admin.res.${resource}`, resource)}
        </th>
      </tr>
      {capabilities.map((capability) => {
        const verb = capability.slice(capability.indexOf('.') + 1);
        return (
          <tr key={capability} className="border-b border-border/60 last:border-b-0">
            <td className="px-5 py-2 text-ink">{label(`admin.verb.${verb}`, verb)}</td>
            {ROLE_ORDER.map((role) => (
              <td key={role} className="px-3 py-2 text-center">
                <span
                  aria-hidden="true"
                  className={holds(role, capability) ? 'text-teal' : 'text-muted'}
                >
                  {holds(role, capability) ? '✓' : '·'}
                </span>
                <span className="sr-only">
                  {intl.formatMessage({
                    id: holds(role, capability) ? 'admin.allowed' : 'admin.notAllowed',
                  })}
                </span>
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}
