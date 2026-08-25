import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusChip,
  useModalFocus,
  type ChipTone,
} from '@mio/ui';
import { postJson, usersQuery, type PatientRow, type StaffRow } from './api.js';
import { EditRolesDialog, RoleCheckboxes, type StaffRoleOption } from './roles-dialog.js';
import { useSession } from '../session/session.js';

/**
 * A1: user management. The administrator sees accounts - name, email,
 * role, status - and NEVER clinical data; the API shape enforces it and
 * the matrix note records it. Credential resets demand the admin's own
 * password again (step-up), and everything here lands in the audit log.
 */

/** The canvas's role tints: the high-privilege roles announce themselves. */
const ROLE_TONE: Record<StaffRow['roles'][number], ChipTone> = {
  clinician: 'teal',
  author: 'neutral',
  administrator: 'amber',
  auditor: 'red',
};
/** Status as quiet colored text per the canvas - chips stay for roles. */
const STATUS_TEXT = {
  invited: 'text-amber',
  active: 'text-teal',
  deactivated: 'text-secondary',
} as const;

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
  const [rolesTarget, setRolesTarget] = useState<StaffRow | null>(null);
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
        <UserTable
          rows={staffRows}
          kind="staff"
          onReset={(row) =>
            setResetTarget({
              realm: 'staff',
              id: row.id,
              name: `${row.given_name} ${row.family_name}`,
            })
          }
          onEditRoles={(row) => setRolesTarget(row)}
        />
      ) : (
        <UserTable
          rows={patientRows}
          kind="patients"
          onReset={(row) =>
            setResetTarget({
              realm: 'patient',
              id: row.id,
              name: `${row.given_name} ${row.family_name}`,
            })
          }
        />
      )}

      {/* the canvas's standing explainer: what a reset does - and does not */}
      <div
        role="note"
        className="rounded-card border border-amber-chip-border bg-amber-tint px-4 py-3 text-sm text-ink"
      >
        <FormattedMessage
          id="admin.resetExplainer"
          values={{ b: (chunks) => <strong>{chunks}</strong> }}
        />
      </div>

      {creating ? <CreateStaffDialog onClose={() => setCreating(false)} /> : null}
      {resetTarget ? (
        <ResetLoginDialog target={resetTarget} onClose={() => setResetTarget(null)} />
      ) : null}
      {rolesTarget ? (
        <EditRolesDialog target={rolesTarget} onClose={() => setRolesTarget(null)} />
      ) : null}
    </div>
  );
}

/** The canvas's A1 table: name, email, role chips, quiet status text and
 * text-link actions per row - a deactivated row greys out. X11(b) holds:
 * no free-form Edit, the actions are roles, reset and lifecycle. */
function UserTable({
  rows,
  kind,
  onReset,
  onEditRoles,
}: {
  rows: (StaffRow | PatientRow)[];
  kind: 'staff' | 'patients';
  onReset: (row: StaffRow | PatientRow) => void;
  onEditRoles?: (row: StaffRow) => void;
}): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const realmOf = (row: StaffRow | PatientRow): 'staff' | 'patient' =>
    'roles' in row ? 'staff' : 'patient';
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
  const th = 'px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted';
  const linkButton =
    'text-sm font-medium text-teal underline underline-offset-4 hover:text-teal-hover';
  return (
    <div className="overflow-x-auto rounded-card border border-black/5 bg-surface shadow-resting">
      <table className="w-full">
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className={th}>
              <FormattedMessage id="admin.col.name" />
            </th>
            <th scope="col" className={`${th} hidden md:table-cell`}>
              <FormattedMessage id="admin.col.email" />
            </th>
            <th scope="col" className={th}>
              {kind === 'staff' ? (
                <FormattedMessage id="admin.col.role" />
              ) : (
                <FormattedMessage id="admin.col.language" />
              )}
            </th>
            <th scope="col" className={th}>
              <FormattedMessage id="admin.col.status" />
            </th>
            <th scope="col" className={th}>
              <span className="sr-only">
                <FormattedMessage id="admin.col.actions" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => {
            const deactivated = row.status === 'deactivated';
            return (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar initials={`${row.given_name[0] ?? ''}${row.family_name[0] ?? ''}`} />
                    <span
                      className={`whitespace-nowrap text-sm font-medium ${deactivated ? 'text-secondary' : 'text-ink'}`}
                    >
                      {row.given_name} {row.family_name}
                    </span>
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-sm text-secondary md:table-cell">
                  {row.email}
                </td>
                <td className="px-4 py-3">
                  {'roles' in row ? (
                    <span className="flex flex-wrap gap-1">
                      {row.roles.map((role) => (
                        <StatusChip key={role} tone={ROLE_TONE[role]}>
                          {intl.formatMessage({ id: `admin.role.${role}` })}
                        </StatusChip>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sm text-secondary">{row.locale.toUpperCase()}</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-sm ${STATUS_TEXT[row.status]}`}>
                  {intl.formatMessage({ id: `admin.status.${row.status}` })}
                </td>
                <td className="px-4 py-3">
                  {/* long FI/SV action labels wrap as a group, never
                      mid-label, so the table stays inside the card */}
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 [&>button]:whitespace-nowrap">
                    {onEditRoles && 'roles' in row && row.id !== session.account?.id ? (
                      // never self-targeting: your own roles are another
                      // administrator's to change
                      <button type="button" className={linkButton} onClick={() => onEditRoles(row)}>
                        <FormattedMessage id="admin.editRoles" />
                      </button>
                    ) : null}
                    <button type="button" className={linkButton} onClick={() => onReset(row)}>
                      <FormattedMessage id="admin.resetLogin" />
                    </button>
                    {deactivated ? (
                      <button
                        type="button"
                        className={linkButton}
                        onClick={() => lifecycle.mutate({ row, verb: 'reactivate' })}
                      >
                        <FormattedMessage id="admin.reactivate" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={linkButton}
                        onClick={() => {
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
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "+ New user": staff accounts only - patient accounts are created at
 * enrolment by the care side, never from the admin plane. */
/** P1 (2026-08-24): identity creation is administration for BOTH
 * realms - the care side enrols existing accounts, never creates them. */
function CreateStaffDialog({ onClose }: { onClose: () => void }): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [realm, setRealm] = useState<'staff' | 'patient'>('staff');
  const [email, setEmail] = useState('');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [roles, setRoles] = useState<StaffRoleOption[]>(['clinician']);
  const [title, setTitle] = useState('');
  const [locale, setLocale] = useState('fi');
  const create = useMutation({
    mutationFn: () =>
      realm === 'staff'
        ? postJson('/api/admin/staff', {
            email,
            givenName,
            familyName,
            roles,
            ...(title.trim() ? { title } : {}),
          })
        : postJson('/api/admin/patients', { email, givenName, familyName, locale }),
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
      <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="create-staff-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="admin.createTitle" />
        </h2>
        <p className="mt-1 text-xs text-muted">
          <FormattedMessage id="admin.createLede" />
        </p>
        <div className="mt-3 flex gap-1.5">
          {(['staff', 'patient'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={realm === option}
              onClick={() => setRealm(option)}
              className={`rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${
                realm === option
                  ? 'border-teal bg-teal-tint font-medium text-teal'
                  : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {intl.formatMessage({ id: `admin.realm.${option}` })}
            </button>
          ))}
        </div>
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
        {realm === 'staff' ? (
          <div className="mt-3 flex flex-col gap-3">
            <RoleCheckboxes value={roles} onChange={setRoles} />
            <label className="block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="admin.field.title" />
              <input
                className={field}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>
          </div>
        ) : (
          <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="admin.field.locale" />
            <select
              className={field}
              value={locale}
              onChange={(event) => setLocale(event.currentTarget.value)}
            >
              {(['fi', 'sv', 'en'] as const).map((option) => (
                <option key={option} value={option}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}
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
              !email.includes('@') ||
              !givenName.trim() ||
              !familyName.trim() ||
              (realm === 'staff' && roles.length === 0) ||
              create.isPending
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
  const modalRef = useModalFocus<HTMLDivElement>();
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
      <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
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
