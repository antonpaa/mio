/**
 * The synthetic world - typed records mirroring docs/architecture/
 * data-model.md. This is the seeding source every later work package
 * consumes; it grows a collection whenever a new entity lands.
 */

export type Locale = 'en' | 'fi' | 'sv';
export type Severity = 'high' | 'moderate' | 'low';

export interface SyntheticPatient {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  locale: Locale;
  address: { street: string; postalCode: string; city: string; country: 'FI' | 'SE' };
}

export type StaffRole = 'clinician' | 'author' | 'administrator' | 'auditor';

export interface SyntheticStaff {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  /** Roles the ACCOUNT holds (union of grants; auditor is exclusive).
   * Being a treatment lead is a care-team position, not a role - see
   * SyntheticTeam.leadIds. */
  roles: StaffRole[];
  title: string;
  locale: Locale;
}

export interface SyntheticTeam {
  id: string;
  name: string;
  memberIds: string[];
  leadIds: string[];
}

export interface SyntheticTreatment {
  id: string;
  templateKey: string;
  name: string;
  patientId: string;
  teamId: string;
  state: 'active' | 'paused' | 'completed' | 'discontinued';
  startedAt: string;
  surveyKeys: string[];
}

export interface SyntheticResponse {
  id: string;
  surveyKey: string;
  treatmentId: string;
  patientId: string;
  week: number;
  answeredAt: string;
  onBehalfOfStaffId?: string;
  answers: { symptom: string; level: 0 | 1 | 2 | 3 }[];
  raisedSeverity?: Severity;
}

export interface SyntheticAlert {
  id: string;
  patientId: string;
  treatmentId: string;
  responseId?: string;
  severity: Severity;
  reason: string;
  state: 'new' | 'acknowledged' | 'resolved';
  assigneeStaffId?: string;
  raisedAt: string;
}

export interface SyntheticMessage {
  id: string;
  threadTreatmentId: string;
  authorId: string;
  authorKind: 'patient' | 'staff';
  internalNote: boolean;
  body: string;
  sentAt: string;
}

export interface SyntheticValueEntry {
  id: string;
  patientId: string;
  series: 'psa' | 'testosterone';
  unit: string;
  value: number;
  measuredAt: string;
  onBehalfOfStaffId?: string;
}

export interface SyntheticTask {
  id: string;
  treatmentId: string;
  title: string;
  dueOffsetDays: number;
  assigneeStaffId?: string;
  state: 'open' | 'unclaimed' | 'done';
}

export interface SyntheticWorld {
  profile: string;
  seed: number;
  patients: SyntheticPatient[];
  staff: SyntheticStaff[];
  teams: SyntheticTeam[];
  treatments: SyntheticTreatment[];
  /** Materialised patient -> staff ids with an active care relationship. */
  careRelationships: Map<string, string[]>;
  responses: SyntheticResponse[];
  alerts: SyntheticAlert[];
  messages: SyntheticMessage[];
  values: SyntheticValueEntry[];
  tasks: SyntheticTask[];
}

export interface Profile {
  name: string;
  patients: number;
  staff: number;
  teams: number;
  administrators: number;
  /** Rich histories (responses, messages, values) or graph-only for perf. */
  histories: boolean;
}

export const PROFILES: Record<'demo' | 'perf', Profile> = {
  demo: { name: 'demo', patients: 40, staff: 18, teams: 4, administrators: 2, histories: true },
  perf: {
    name: 'perf',
    patients: 20_000,
    staff: 800,
    teams: 40,
    administrators: 8,
    histories: false,
  },
};
