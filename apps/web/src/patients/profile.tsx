import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { FormattedMessage } from 'react-intl';
import { Avatar, ErrorState, Skeleton } from '@mio/ui';

interface PatientProfile {
  patientId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  email: string;
  phone: string | null;
  locale: string;
  careTeamSize: number;
}

async function fetchProfile(patientId: string): Promise<PatientProfile> {
  const response = await fetch(`/api/staff/patients/${patientId}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`profile failed: ${response.status}`);
  return (await response.json()) as PatientProfile;
}

/** The PP sub-navigation (C2): groups are headers, not links; pages land
 * with their work packages and gate on capabilities as they do. */
function SubNav(): ReactElement {
  const group = (id: string, items: ReactNode): ReactElement => (
    <div className="mb-4">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <FormattedMessage id={id} />
      </p>
      <ul className="flex flex-col gap-0.5 text-sm">{items}</ul>
    </div>
  );
  const item = (id: string, active = false): ReactElement => (
    <li key={id}>
      <span
        className={
          'block rounded-inner px-2 py-1 ' +
          (active ? 'bg-teal-tint font-medium text-teal' : 'text-ink-strong-secondary')
        }
        {...(active ? { 'aria-current': 'page' } : {})}
      >
        <FormattedMessage id={id} />
      </span>
    </li>
  );
  return (
    <nav aria-label="Patient sections" className="w-56 shrink-0">
      {group(
        'pp.group.profile',
        <>
          {item('pp.summary', true)}
          {item('pp.programs')}
          {item('pp.details')}
        </>,
      )}
      {group(
        'pp.group.health',
        <>
          {item('pp.values')}
          {item('pp.symptoms')}
          {item('pp.completedSurveys')}
          {item('pp.export')}
        </>,
      )}
    </nav>
  );
}

export function PatientProfilePage(): ReactElement {
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const profile = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => fetchProfile(patientId),
    retry: false,
  });

  if (profile.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (profile.isError) {
    return <ErrorState onRetry={() => void profile.refetch()} />;
  }
  const patient = profile.data;

  return (
    <div className="flex gap-8">
      <SubNav />
      <div className="min-w-0 flex-1">
        <header className="mb-6 flex items-center gap-4 rounded-card border border-black/5 bg-surface p-5 shadow-resting">
          <Avatar
            initials={`${patient.givenName[0] ?? ''}${patient.familyName[0] ?? ''}`}
            label={`${patient.givenName} ${patient.familyName}`}
          />
          <div>
            <h1 className="font-display text-xl italic text-ink">
              {patient.givenName} {patient.familyName}
            </h1>
            <p className="text-sm text-secondary">
              {patient.email}
              {patient.phone ? ` — ${patient.phone}` : ''}
            </p>
            <p className="text-xs text-muted">
              <FormattedMessage id="pp.careTeam" values={{ count: patient.careTeamSize }} />
            </p>
          </div>
        </header>
        <p className="text-sm text-secondary">
          <FormattedMessage id="pp.placeholder" />
        </p>
      </div>
    </div>
  );
}
