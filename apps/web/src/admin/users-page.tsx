import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, Button, EmptyState, ErrorState, ListRow, Skeleton, StatusChip } from '@mio/ui';
import { postJson, usersQuery, type PatientRow, type StaffRow } from './api.js';

/**
 * A1: user management. The administrator sees accounts - name, email,
 * role, status - and NEVER clinical data; the API shape enforces it and
 * the matrix note records it. Credential resets demand the admin's own
 * password again (step-up), and everything here lands in the audit log.
 */

const STAFF_ROLES = ['treatment_member', 'treatment_lead', 'administrator'] as const;
const STATUS_TONE = { invited: 'amber', active: 'teal', deactivated: 'neutral' } as const;

type Tab = 'staff' | 'patients';

export function AdminUsersPage(): ReactElement {
  const intl = useIntl();
  const [tab, setTab] = useState<Tab>('staff');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<{
    realm: 'staff' | 'patient';
    id: string;
    name: string;
  } | null>(null);
  const users = useQuery(usersQuery);

  if (users.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (users.isError) return <ErrorState onRetry={() => void users.refetch()} />;

  const needle = query.trim().toLowerCase();
  const matches = (row: { given_name: string; family_name: string; email: string }): boolean =>
    needle === '' ||
    `${row.given_name} ${row.family_name}`.toLowerCase().includes(needle) ||
    row.email.toLowerCase().includes(needle);
  const staffRows = users.data.staff.filter(matches);
  const patientRows = users.data.patients.filter(matches);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl italic text-ink">
            <FormattedMessage id="nav.users" />
          </h1>
          <p className="mt-1 text-sm text-secondary">
            <FormattedMessage id="admin.usersLede" />
          </p>
        </div>
        <Button size="sm" onPress={() => setCreating(true)}>
          <FormattedMessage id="admin.newUser" />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1.5">
          {(['staff', 'patients'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={tab === option}
              onClick={() => setTab(option)}
              className={`rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${
                tab === option
                  ? 'border-teal bg-teal-tint font-medium text-teal'
                  : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {intl.formatMessage(
                { id: `admin.tab.${option}` },
                { count: users.data[option].length },
              )}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={intl.formatMessage({ id: 'admin.search' })}
          aria-label={intl.formatMessage({ id: 'admin.search' })}
          className="w-64 rounded-pill border border-border bg-surface px-4 py-2 text-sm"
        />
      </div>

      {tab === 'staff' ? (
        <UserList
          rows={staffRows}
          detail={(row) => intl.formatMessage({ id: `admin.role.${(row as StaffRow).role}` })}
          onReset={(row) =>
            setResetTarget({
              realm: 'staff',
              id: row.id,
              name: `${row.given_name} ${row.family_name}`,
            })
          }
        />
      ) : (
        <UserList
          rows={patientRows}
          detail={(row) => (row as PatientRow).locale.toUpperCase()}
          onReset={(row) =>
            setResetTarget({
              realm: 'patient',
              id: row.id,
              name: `${row.given_name} ${row.family_name}`,
            })
          }
        />
      )}

      {creating ? <CreateStaffDialog onClose={() => setCreating(false)} /> : null}
      {resetTarget ? (
        <ResetLoginDialog target={resetTarget} onClose={() => setResetTarget(null)} />
      ) : null}
    </div>
  );
}

function UserList({
  rows,
  detail,
  onReset,
}: {
  rows: (StaffRow | PatientRow)[];
  detail: (row: StaffRow | PatientRow) => string;
  onReset: (row: StaffRow | PatientRow) => void;
}): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const realmOf = (row: StaffRow | PatientRow): 'staff' | 'patient' =>
    'role' in row ? 'staff' : 'patient';
  const lifecycle = useMutation({
    mutationFn: ({ row, verb }: { row: StaffRow | PatientRow; verb: string }) =>
      postJson(`/api/admin/users/${realmOf(row)}/${row.id}/${verb}`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  if (rows.length === 0) {
    return (
      <EmptyState title={intl.formatMessage({ id: 'admin.noMatches' })}>
        <FormattedMessage id="admin.noMatchesBody" />
      </EmptyState>
    );
  }
  return (
    <div className="rounded-card border border-black/5 bg-surface px-5 shadow-resting">
      {rows.map((row) => (
        <ListRow
          key={row.id}
          leading={<Avatar initials={`${row.given_name[0] ?? ''}${row.family_name[0] ?? ''}`} />}
          trailing={
            <div className="flex items-center gap-2">
              <StatusChip tone={STATUS_TONE[row.status]}>
                {intl.formatMessage({ id: `admin.status.${row.status}` })}
              </StatusChip>
              <Button size="sm" variant="quiet" onPress={() => onReset(row)}>
                <FormattedMessage id="admin.resetLogin" />
              </Button>
              {row.status === 'deactivated' ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onPress={() => lifecycle.mutate({ row, verb: 'reactivate' })}
                >
                  <FormattedMessage id="admin.reactivate" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="quiet"
                  onPress={() => {
                    if (
                      window.confirm(
                        intl.formatMessage(
                          { id: 'admin.confirmDeactivate' },
                          { name: `${row.given_name} ${row.family_name}` },
                        ),
                      )
                    ) {
                      lifecycle.mutate({ row, verb: 'deactivate' });
                    }
                  }}
                >
                  <FormattedMessage id="admin.deactivate" />
                </Button>
              )}
            </div>
          }
        >
          <p className="text-sm font-medium text-ink">
            {row.given_name} {row.family_name}
            <span className="ml-2 text-xs font-normal text-muted">{detail(row)}</span>
          </p>
          <p className="text-xs text-secondary">{row.email}</p>
        </ListRow>
      ))}
    </div>
  );
}

/** "+ New user": staff accounts only - patient accounts are created at
 * enrolment by the care side, never from the admin plane. */
function CreateStaffDialog({ onClose }: { onClose: () => void }): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [role, setRole] = useState<(typeof STAFF_ROLES)[number]>('treatment_member');
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () =>
      postJson('/api/admin/staff', {
        email,
        givenName,
        familyName,
        role,
        ...(title.trim() ? { title } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
  });
  const field =
    'mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-staff-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="create-staff-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="admin.createTitle" />
        </h2>
        <p className="mt-1 text-xs text-muted">
          <FormattedMessage id="admin.createLede" />
        </p>
        <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
          <FormattedMessage id="admin.field.email" />
          <input
            type="email"
            className={field}
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="admin.field.givenName" />
            <input
              className={field}
              value={givenName}
              onChange={(event) => setGivenName(event.currentTarget.value)}
            />
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="admin.field.familyName" />
            <input
              className={field}
              value={familyName}
              onChange={(event) => setFamilyName(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="admin.field.role" />
            <select
              className={field}
              value={role}
              onChange={(event) =>
                setRole(event.currentTarget.value as (typeof STAFF_ROLES)[number])
              }
            >
              {STAFF_ROLES.map((option) => (
                <option key={option} value={option}>
                  {intl.formatMessage({ id: `admin.role.${option}` })}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="admin.field.title" />
            <input
              className={field}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
        </div>
        {create.isError ? (
          <p className="mt-3 text-sm text-red" role="alert">
            <FormattedMessage id="admin.createFailed" />
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button
            size="sm"
            onPress={() => create.mutate()}
            isDisabled={
              !email.includes('@') || !givenName.trim() || !familyName.trim() || create.isPending
            }
          >
            <FormattedMessage id="admin.createSend" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Step-up: the admin re-enters their OWN password. The reset sends a
 * fresh setup link and revokes sessions - it never touches data. */
function ResetLoginDialog({
  target,
  onClose,
}: {
  target: { realm: 'staff' | 'patient'; id: string; name: string };
  onClose: () => void;
}): ReactElement {
  const intl = useIntl();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const reset = useMutation({
    mutationFn: () =>
      postJson(`/api/admin/users/${target.realm}/${target.id}/reset-login`, { password }),
    onSuccess: () => setDone(true),
  });
  const stepUpFailed = reset.isError && (reset.error as Error).message === 'step_up_required';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-login-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="reset-login-title" className="font-display text-lg italic text-ink">
          {intl.formatMessage({ id: 'admin.resetTitle' }, { name: target.name })}
        </h2>
        {done ? (
          <>
            <p className="mt-3 text-sm text-secondary">
              <FormattedMessage id="admin.resetDone" />
            </p>
            <div className="mt-5 flex justify-end">
              <Button size="sm" onPress={onClose}>
                <FormattedMessage id="common.close" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              <FormattedMessage id="admin.resetNote" />
            </p>
            <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="admin.stepUpLabel" />
              <input
                type="password"
                autoComplete="current-password"
                className="mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            {stepUpFailed ? (
              <p className="mt-2 text-sm text-red" role="alert">
                <FormattedMessage id="admin.stepUpWrong" />
              </p>
            ) : reset.isError ? (
              <p className="mt-2 text-sm text-red" role="alert">
                <FormattedMessage id="admin.resetFailed" />
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="quiet" onPress={onClose}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button
                size="sm"
                onPress={() => reset.mutate()}
                isDisabled={password === '' || reset.isPending}
              >
                <FormattedMessage id="admin.resetSend" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
