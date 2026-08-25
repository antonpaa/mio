import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, useModalFocus } from '@mio/ui';
import { postJson } from './api.js';

/**
 * The role-set editor, shared by A1 (user rows) and A5 (team member
 * rows): wherever an administrator SEES an account's roles, they can
 * change them - through the one audited endpoint. Account roles and
 * team membership stay separate concerns: joining a team never grants
 * a role, and editing roles never touches membership.
 */

export const STAFF_ROLES = ['clinician', 'author', 'administrator', 'auditor'] as const;
export type StaffRoleOption = (typeof STAFF_ROLES)[number];

/** Auditor is exclusive (segregation of duties): choosing it clears the
 * rest, choosing anything else clears it. */
function toggleRole(current: StaffRoleOption[], role: StaffRoleOption): StaffRoleOption[] {
  if (current.includes(role)) return current.filter((held) => held !== role);
  if (role === 'auditor') return ['auditor'];
  return [...current.filter((held) => held !== 'auditor'), role];
}

export function RoleCheckboxes({
  value,
  onChange,
}: {
  value: StaffRoleOption[];
  onChange: (next: StaffRoleOption[]) => void;
}): ReactElement {
  const intl = useIntl();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-strong-secondary">
        <FormattedMessage id="admin.field.role" />
      </legend>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
        {STAFF_ROLES.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={value.includes(option)}
              onChange={() => onChange(toggleRole(value, option))}
            />
            {intl.formatMessage({ id: `admin.role.${option}` })}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The 2026-08-25 restructure's A1 verb: edit the role SET an account
 * holds. The server refuses self-targeting, empty sets and any auditor
 * combination; the checkboxes mirror those rules so the refusal is
 * rarely seen. */
export function EditRolesDialog({
  target,
  onClose,
}: {
  target: { id: string; given_name: string; family_name: string; roles: string[] };
  onClose: () => void;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<StaffRoleOption[]>(target.roles as StaffRoleOption[]);
  const save = useMutation({
    mutationFn: () => postJson(`/api/admin/users/staff/${target.id}/roles`, { roles }),
    onSuccess: () => {
      // both surfaces render role sets - refresh whichever is behind
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
      onClose();
    },
  });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-roles-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="edit-roles-title" className="font-display text-lg italic text-ink">
          {intl.formatMessage(
            { id: 'admin.editRolesTitle' },
            { name: `${target.given_name} ${target.family_name}` },
          )}
        </h2>
        <p className="mt-1 text-xs text-muted">
          <FormattedMessage id="admin.editRolesNote" />
        </p>
        <div className="mt-4">
          <RoleCheckboxes value={roles} onChange={setRoles} />
        </div>
        {save.isError ? (
          <p className="mt-3 text-sm text-red" role="alert">
            <FormattedMessage id="admin.editRolesFailed" />
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button
            size="sm"
            onPress={() => save.mutate()}
            isDisabled={roles.length === 0 || save.isPending}
          >
            <FormattedMessage id="admin.rolesSave" />
          </Button>
        </div>
      </div>
    </div>
  );
}
