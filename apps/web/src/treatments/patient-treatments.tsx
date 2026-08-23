import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, EmptyState, ErrorState, ListRow, Skeleton, StatusChip } from '@mio/ui';

interface OwnTreatment {
  id: string;
  name: string;
  detail: string;
  state: 'draft' | 'active' | 'paused' | 'completed' | 'discontinued';
  team: { given_name: string; family_name: string; title: string | null; is_lead: boolean }[];
}

const STATE_TONE = {
  draft: 'neutral',
  active: 'teal',
  paused: 'amber',
  completed: 'neutral',
  discontinued: 'red',
} as const;

const INACTIVE = new Set(['completed', 'discontinued']);

/** P5: the patient's treatments - team, state; inactive hidden by default. */
export function PatientTreatmentsPage(): ReactElement {
  const intl = useIntl();
  const [showInactive, setShowInactive] = useState(false);
  const treatments = useQuery({
    queryKey: ['own-treatments'],
    queryFn: async () => {
      const response = await fetch('/api/patient/treatments', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`treatments: ${response.status}`);
      return (await response.json()) as OwnTreatment[];
    },
  });

  if (treatments.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (treatments.isError) return <ErrorState onRetry={() => void treatments.refetch()} />;

  const visible = treatments.data.filter(
    (treatment) => showInactive || !INACTIVE.has(treatment.state),
  );
  const hiddenCount =
    treatments.data.length - treatments.data.filter((t) => !INACTIVE.has(t.state)).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="nav.treatments" />
      </h1>
      {visible.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'ownTreatments.emptyTitle' })}>
          <FormattedMessage id="ownTreatments.emptyBody" />
        </EmptyState>
      ) : (
        visible.map((treatment) => (
          <section
            key={treatment.id}
            className="rounded-card border border-black/5 bg-surface p-5 shadow-resting"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-ink">{treatment.name}</h2>
              <StatusChip tone={STATE_TONE[treatment.state]}>
                {intl.formatMessage({ id: `treatment.state.${treatment.state}` })}
              </StatusChip>
            </div>
            {treatment.detail ? (
              <p className="mt-1 text-sm text-secondary">{treatment.detail}</p>
            ) : null}
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <FormattedMessage id="ownTreatments.yourTeam" />
            </p>
            {treatment.team.slice(0, 4).map((member, index) => (
              <ListRow
                key={index}
                leading={
                  <Avatar
                    initials={`${member.given_name[0] ?? ''}${member.family_name[0] ?? ''}`}
                  />
                }
              >
                <p className="text-sm text-ink">
                  {member.given_name} {member.family_name}
                  <span className="ml-2 text-xs text-muted">
                    {member.is_lead
                      ? intl.formatMessage({ id: 'ownTreatments.responsible' })
                      : (member.title ?? '')}
                  </span>
                </p>
              </ListRow>
            ))}
          </section>
        ))
      )}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowInactive((value) => !value)}
          className="self-center text-sm text-teal hover:text-teal-hover"
        >
          {showInactive ? (
            <FormattedMessage id="ownTreatments.hideInactive" />
          ) : (
            <FormattedMessage id="ownTreatments.showInactive" values={{ count: hiddenCount }} />
          )}
        </button>
      ) : null}
    </div>
  );
}
