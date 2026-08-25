import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, Button, Card, EmptyState, ErrorState, Skeleton, useModalFocus } from '@mio/ui';
import { postJson, teamsQuery, usersQuery, type TeamRow } from './api.js';
import { EditRolesDialog } from './roles-dialog.js';
import { useSession } from '../session/session.js';

/**
 * A5: teams - named groups of staff, attachable to treatments. The admin
 * plane edits the GROUP; what the group can see is decided per treatment
 * on the care side, so nothing clinical appears here. Account roles are
 * a separate axis: membership never grants one, but wherever roles are
 * SHOWN they are editable (the shared roles dialog).
 */

export function AdminTeamsPage(): ReactElement {
  const intl = useIntl();
  const teams = useQuery(teamsQuery);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);

  if (teams.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (teams.isError) return <ErrorState onRetry={() => void teams.refetch()} />;

  const managed = teams.data.find((team) => team.id === managing);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="nav.teams" />
        </h1>
        <Button size="sm" onPress={() => setCreating(true)}>
          <FormattedMessage id="admin.newTeam" />
        </Button>
      </div>

      {teams.data.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'admin.noTeams' })}>
          <FormattedMessage id="admin.noTeamsBody" />
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {teams.data.map((team) => (
            <Card key={team.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-ink">{team.name}</h2>
                  <p className="mt-0.5 text-xs text-secondary">
                    {intl.formatMessage(
                      { id: 'admin.memberCount' },
                      { count: team.members.length },
                    )}
                  </p>
                </div>
                <Button size="sm" variant="quiet" onPress={() => setManaging(team.id)}>
                  <FormattedMessage id="admin.manage" />
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-1">
                {team.members.slice(0, 6).map((member) => (
                  <Avatar
                    key={member.id}
                    initials={`${member.given_name[0] ?? ''}${member.family_name[0] ?? ''}`}
                    label={`${member.given_name} ${member.family_name}`}
                  />
                ))}
                {team.members.length > 6 ? (
                  <span className="text-xs text-muted">+{team.members.length - 6}</span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating ? <CreateTeamDialog onClose={() => setCreating(false)} /> : null}
      {managed ? <MembershipDialog team={managed} onClose={() => setManaging(null)} /> : null}
    </div>
  );
}

/** The same pattern as A1's "+ New user": the button always works and the
 * dialog asks for what it needs - an inline field with a silently
 * disabled submit read as "cannot create teams". */
function CreateTeamDialog({ onClose }: { onClose: () => void }): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => postJson<{ teamId: string }>('/api/admin/teams', { name: name.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
      onClose();
    },
  });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-team-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="create-team-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="admin.createTeam" />
        </h2>
        <p className="mt-1 text-xs text-muted">
          <FormattedMessage id="admin.createTeamLede" />
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) create.mutate();
          }}
        >
          <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="admin.teamName" />
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink"
            />
          </label>
          {create.isError ? (
            <p className="mt-3 text-sm text-red" role="alert">
              <FormattedMessage id="admin.teamCreateFailed" />
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="quiet" onPress={onClose}>
              <FormattedMessage id="common.cancel" />
            </Button>
            <Button size="sm" type="submit" isDisabled={!name.trim() || create.isPending}>
              <FormattedMessage id="admin.createTeam" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MembershipDialog({ team, onClose }: { team: TeamRow; onClose: () => void }): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const users = useQuery(usersQuery);
  const [adding, setAdding] = useState('');
  const [rolesTarget, setRolesTarget] = useState<TeamRow['members'][number] | null>(null);
  const change = useMutation({
    mutationFn: (delta: { add?: string[]; remove?: string[] }) =>
      postJson(`/api/admin/teams/${team.id}/membership`, delta),
    onSuccess: () => {
      setAdding('');
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
    },
  });
  const memberIds = new Set(team.members.map((member) => member.id));
  // A care team is a clinical group, so only clinician-role holders are
  // offered. Adding to a team never grants a role - grant clinician in
  // the roles editor first and the person appears here.
  const candidates = (users.data?.staff ?? []).filter(
    (row) =>
      !memberIds.has(row.id) && row.status !== 'deactivated' && row.roles.includes('clinician'),
  );
  const roleLabel = (roles: readonly string[]): string =>
    roles.map((role) => intl.formatMessage({ id: `admin.role.${role}` })).join(' + ');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="membership-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="membership-title" className="font-display text-lg italic text-ink">
          {team.name}
        </h2>
        <ul className="mt-4 flex flex-col gap-1">
          {team.members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink">
                {member.given_name} {member.family_name}
                <span className="ml-2 text-xs text-muted">{roleLabel(member.roles)}</span>
              </span>
              <span className="flex items-center gap-1">
                {member.id !== session.account?.id ? (
                  // never self-targeting: your own roles are another
                  // administrator's to change
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={intl.formatMessage(
                      { id: 'admin.editRolesTitle' },
                      { name: `${member.given_name} ${member.family_name}` },
                    )}
                    onPress={() => setRolesTarget(member)}
                  >
                    <FormattedMessage id="admin.editRoles" />
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={intl.formatMessage(
                    { id: 'admin.removeMember' },
                    { name: `${member.given_name} ${member.family_name}` },
                  )}
                  onPress={() => change.mutate({ remove: [member.id] })}
                >
                  <FormattedMessage id="common.remove" />
                </Button>
              </span>
            </li>
          ))}
          {team.members.length === 0 ? (
            <li className="text-sm text-secondary">
              <FormattedMessage id="admin.noMembers" />
            </li>
          ) : null}
        </ul>
        <div className="mt-4 flex gap-2">
          <select
            aria-label={intl.formatMessage({ id: 'admin.pickStaff' })}
            className="block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={adding}
            onChange={(event) => setAdding(event.currentTarget.value)}
          >
            <option value="">{intl.formatMessage({ id: 'admin.pickStaff' })}</option>
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.given_name} {row.family_name} — {roleLabel(row.roles)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            isDisabled={adding === '' || change.isPending}
            onPress={() => change.mutate({ add: [adding] })}
          >
            <FormattedMessage id="admin.addMember" />
          </Button>
        </div>
        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.close" />
          </Button>
        </div>
      </div>
      {rolesTarget ? (
        <EditRolesDialog target={rolesTarget} onClose={() => setRolesTarget(null)} />
      ) : null}
    </div>
  );
}
