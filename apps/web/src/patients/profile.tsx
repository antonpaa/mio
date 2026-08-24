import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Avatar,
  Card,
  CardHeader,
  ErrorState,
  IconTreatments,
  ListRow,
  Skeleton,
  StatusChip,
} from '@mio/ui';
import { ValuesCard } from '../observations/values-card.js';
import { SymptomsCard } from '../observations/symptoms-card.js';
import { EditContactButton } from './contact-dialog.js';
import { ResponsesCard } from '../surveys/responses-card.js';
import { ExportDataButton } from './export-dialog.js';
import { MarkDeceasedButton } from './deceased-dialog.js';
import { ROLE_CAPABILITIES, type Role } from '@mio/authz';
import { useSession } from '../session/session.js';

interface PatientProfile {
  patientId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  email: string;
  phone: string | null;
  address: Record<string, string> | null;
  locale: string;
  careTeamSize: number;
  deceasedOn: string | null;
}

interface ProgramRow {
  id: string;
  name: string;
  state: 'draft' | 'active' | 'paused' | 'completed' | 'discontinued';
  version: number | null;
  template_name: string | null;
}

const PROGRAM_TONE = {
  draft: 'neutral',
  active: 'teal',
  paused: 'amber',
  completed: 'neutral',
  discontinued: 'red',
} as const;

function ProgramsCard({ patientId }: { patientId: string }): ReactElement {
  const intl = useIntl();
  const programs = useQuery({
    queryKey: ['patient-programs', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/treatments`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`programs: ${response.status}`);
      return (await response.json()) as ProgramRow[];
    },
    retry: false,
  });
  if (programs.isPending) return <Skeleton className="h-28 w-full" />;
  if (programs.isError) return <ErrorState onRetry={() => void programs.refetch()} />;
  return (
    <Card>
      <CardHeader
        icon={<IconTreatments size={17} />}
        title={<FormattedMessage id="pp.programsCard" />}
      />
      {programs.data.length === 0 ? (
        <p className="text-sm text-secondary">
          <FormattedMessage id="pp.noPrograms" />
        </p>
      ) : (
        programs.data.map((program) => (
          <ListRow
            key={program.id}
            trailing={
              <Link
                to="/treatments/$treatmentId"
                params={{ treatmentId: program.id }}
                className="text-teal hover:text-teal-hover"
              >
                <FormattedMessage id="roster.open" />
              </Link>
            }
          >
            <p className="text-sm font-medium text-ink">
              {program.name}
              <span className="ml-2">
                <StatusChip tone={PROGRAM_TONE[program.state]}>
                  {intl.formatMessage({ id: `treatment.state.${program.state}` })}
                </StatusChip>
              </span>
            </p>
            {program.template_name ? (
              <p className="text-xs text-muted">
                {program.template_name} v{program.version}
              </p>
            ) : null}
          </ListRow>
        ))
      )}
    </Card>
  );
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
  const intl = useIntl();
  const session = useSession();
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
  const role = (session.account?.role ?? 'treatment_member') as Role;
  const mayMarkDeceased = ROLE_CAPABILITIES[role].includes('patient_account.mark_deceased');
  const mayEditContact = ROLE_CAPABILITIES[role].includes(
    'patient_identity.update_contact_details',
  );

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
              {patient.deceasedOn !== null ? (
                <span className="ml-3 align-middle">
                  <StatusChip tone="neutral">
                    {intl.formatMessage(
                      { id: 'pp.deceased' },
                      {
                        date: intl.formatDate(patient.deceasedOn, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        }),
                      },
                    )}
                  </StatusChip>
                </span>
              ) : null}
            </h1>
            <p className="text-sm text-secondary">
              {patient.email}
              {patient.phone ? ` — ${patient.phone}` : ''}
            </p>
            <p className="text-xs text-muted">
              <FormattedMessage id="pp.careTeam" values={{ count: patient.careTeamSize }} />
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {patient.deceasedOn === null && mayEditContact ? (
              <EditContactButton
                patientId={patientId}
                current={{
                  phone: patient.phone,
                  address: patient.address,
                  locale: patient.locale,
                }}
              />
            ) : null}
            {patient.deceasedOn === null && mayMarkDeceased ? (
              <MarkDeceasedButton
                patientId={patientId}
                patientName={`${patient.givenName} ${patient.familyName}`}
              />
            ) : null}
            <ExportDataButton
              patientId={patientId}
              patientName={`${patient.givenName} ${patient.familyName}`}
            />
          </div>
        </header>
        <div className="flex flex-col gap-4">
          <ProgramsCard patientId={patientId} />
          <ValuesCard patientId={patientId} />
          <SymptomsCard patientId={patientId} />
          <ResponsesCard patientId={patientId} />
        </div>
      </div>
    </div>
  );
}
