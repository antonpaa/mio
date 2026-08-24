import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, Button, Card, EmptyState, ErrorState, Skeleton } from '@mio/ui';
import { postJson, teamsQuery, usersQuery, type TeamRow } from './api.js';

/**
 * A5: teams - named groups of staff, attachable to treatments. The admin
 * plane edits the GROUP; what the group can see is decided per treatment
 * on the care side, so nothing clinical appears here.
 */

export function AdminTeamsPage(): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const teams = useQuery(teamsQuery);
  const [name, setName] = useState('');
  const [managing, setManaging] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => postJson<{ teamId: string }>('/api/admin/teams', { name }),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
    },
  });

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
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={intl.formatMessage({ id: 'admin.teamName' })}
            aria-label={intl.formatMessage({ id: 'admin.teamName' })}
            className="w-56 rounded-pill border border-border bg-surface px-4 py-2 text-sm"
          />
          <Button size="sm" type="submit" isDisabled={!name.trim() || create.isPending}>
            <FormattedMessage id="admin.newTeam" />
          </Button>
        </form>
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

      {managed ? <MembershipDialog team={managed} onClose={() => setManaging(null)} /> : null}
    </div>
  );
}

function MembershipDialog({ team, onClose }: { team: TeamRow; onClose: () => void }): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const users = useQuery(usersQuery);
  const [adding, setAdding] = useState('');
  const change = useMutation({
    mutationFn: (delta: { add?: string[]; remove?: string[] }) =>
      postJson(`/api/admin/teams/${team.id}/membership`, delta),
    onSuccess: () => {
      setAdding('');
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
    },
  });
  const memberIds = new Set(team.members.map((member) => member.id));
  const candidates = (users.data?.staff ?? []).filter(
    (row) => !memberIds.has(row.id) && row.status !== 'deactivated',
  );
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
      <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="membership-title" className="font-display text-lg italic text-ink">
          {team.name}
        </h2>
        <ul className="mt-4 flex flex-col gap-1">
          {team.members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink">
                {member.given_name} {member.family_name}
                <span className="ml-2 text-xs text-muted">
                  {intl.formatMessage({ id: `admin.role.${member.role}` })}
                </span>
              </span>
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
                {row.given_name} {row.family_name}
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
    </div>
  );
}
