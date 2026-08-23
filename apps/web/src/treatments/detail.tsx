import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { ROLE_CAPABILITIES, type Role } from '@mio/authz';
import { Avatar, Button, ErrorState, ListRow, Skeleton, StatusChip } from '@mio/ui';
import { ActivitiesSection } from '../scheduling/activities-section.js';
import { useSession } from '../session/session.js';

interface TeamEntry {
  id: string;
  staff_id: string | null;
  team_id: string | null;
  role: 'member' | 'lead';
  staff_given: string | null;
  staff_family: string | null;
  title: string | null;
  team_name: string | null;
  team_size: number | null;
}
interface TreatmentDetail {
  id: string;
  patientId: string;
  name: string;
  detail: string;
  state: 'draft' | 'active' | 'paused' | 'completed' | 'discontinued';
  modifiedFromTemplate: boolean;
  template: { template_name?: string; version: number } | null;
  team: TeamEntry[];
  legalTransitions: string[];
}

const STATE_TONE = {
  draft: 'neutral',
  active: 'teal',
  paused: 'amber',
  completed: 'neutral',
  discontinued: 'red',
} as const;

/** T1 slice: lifecycle, team, template provenance. Activities arrive with
 * WP-12, surveys with WP-17. */
export function TreatmentDetailPage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const { treatmentId } = useParams({ strict: false }) as { treatmentId: string };
  const treatment = useQuery({
    queryKey: ['treatment', treatmentId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`detail: ${response.status}`);
      return (await response.json()) as TreatmentDetail;
    },
    retry: false,
  });
  const changeState = useMutation({
    mutationFn: async (to: string) => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ to }),
      });
      if (!response.ok) throw new Error(`state: ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treatment', treatmentId] }),
  });

  if (treatment.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (treatment.isError) return <ErrorState onRetry={() => void treatment.refetch()} />;
  const data = treatment.data;

  const role: Role =
    session.realm === 'patient'
      ? 'patient'
      : ((session.account?.role ?? 'treatment_member') as Role);
  const mayChangeState = ROLE_CAPABILITIES[role].includes('treatment.change_lifecycle_state');

  return (
    <div className="flex flex-col gap-5">
      <header className="rounded-card border border-black/5 bg-surface p-5 shadow-resting">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl italic text-ink">{data.name}</h1>
          <StatusChip tone={STATE_TONE[data.state]}>
            {intl.formatMessage({ id: `treatment.state.${data.state}` })}
          </StatusChip>
        </div>
        {data.detail ? <p className="mt-1 text-sm text-secondary">{data.detail}</p> : null}
        {data.template ? (
          <p className="mt-2 text-xs text-muted">
            <FormattedMessage
              id={
                data.modifiedFromTemplate
                  ? 'treatment.fromTemplateModified'
                  : 'treatment.fromTemplate'
              }
              values={{ name: data.template.template_name, version: data.template.version }}
            />
          </p>
        ) : null}
        {mayChangeState && data.legalTransitions.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.legalTransitions.map((to) => (
              <Button
                key={to}
                variant={to === 'discontinued' ? 'danger' : 'quiet'}
                size="sm"
                isDisabled={changeState.isPending}
                onPress={() => void changeState.mutate(to)}
              >
                {intl.formatMessage({ id: `treatment.transition.${to}` })}
              </Button>
            ))}
          </div>
        ) : null}
      </header>

      <ActivitiesSection treatmentId={treatmentId} />

      <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
        <h2 className="mb-2 text-sm font-semibold text-ink">
          <FormattedMessage id="treatment.team" />
        </h2>
        {data.team.map((entry) => (
          <ListRow
            key={entry.id}
            leading={
              <Avatar
                initials={
                  entry.staff_id
                    ? `${entry.staff_given?.[0] ?? ''}${entry.staff_family?.[0] ?? ''}`
                    : '⚑'
                }
              />
            }
            trailing={
              entry.role === 'lead' ? (
                <StatusChip tone="teal">{intl.formatMessage({ id: 'treatment.lead' })}</StatusChip>
              ) : undefined
            }
          >
            {entry.staff_id ? (
              <p className="text-sm text-ink">
                {entry.staff_given} {entry.staff_family}
                {entry.title ? (
                  <span className="ml-2 text-xs text-muted">{entry.title}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-sm text-ink">
                <FormattedMessage
                  id="treatment.attachedTeam"
                  values={{ name: entry.team_name, count: entry.team_size ?? 0 }}
                />
              </p>
            )}
          </ListRow>
        ))}
      </section>
    </div>
  );
}
