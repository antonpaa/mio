import type { ChipTone } from '@mio/ui';

/**
 * The triage queue and PP6 detail shapes as the API returns them, plus
 * the citation renderer's inputs. Severity is never color-alone anywhere
 * these render (SeverityChip pairs dot + label).
 */

export interface TriageRow {
  id: string;
  severity: 'low' | 'moderate' | 'high';
  status: 'new' | 'acknowledged' | 'resolved';
  created_at: string;
  treatment_id: string;
  patient_id: string;
  survey_response_id: string | null;
  assignee_id: string | null;
  treatment_name: string;
  patient_given: string;
  patient_family: string;
  assignee_given: string | null;
  assignee_family: string | null;
  survey_name: string | null;
  trigger_count: number;
}

export interface TriggerCitation {
  questionLabel: string;
  kind: 'option' | 'at_least' | 'at_most' | 'critical_region' | 'other_region' | 'region_count';
  valueLabel?: string;
  threshold?: number;
  observed?: unknown;
  regions?: string[];
}

export interface AlertDetail {
  alert: {
    id: string;
    severity: 'low' | 'moderate' | 'high';
    status: 'new' | 'acknowledged' | 'resolved';
    created_at: string;
    treatment_id: string;
    patient_id: string;
    survey_response_id: string | null;
    assignee_id: string | null;
    treatment_name: string;
    patient_given: string;
    patient_family: string;
    survey_name: string | null;
    submitted_at: string | null;
    assignee_given: string | null;
    assignee_family: string | null;
    assigned_at: string | null;
    assigned_by_given: string | null;
    assigned_by_family: string | null;
    acknowledged_at: string | null;
    acknowledged_given: string | null;
    acknowledged_family: string | null;
    resolved_at: string | null;
    resolved_given: string | null;
    resolved_family: string | null;
  };
  triggers: {
    id: string;
    rule_id: string;
    severity: 'low' | 'moderate' | 'high' | null;
    fired_at: string;
    citation: TriggerCitation;
  }[];
  comments: {
    id: string;
    body: string;
    created_at: string;
    author_given: string;
    author_family: string;
  }[];
  team: {
    staff_id: string;
    is_lead: boolean;
    given_name: string;
    family_name: string;
    title: string | null;
  }[];
}

export const ALERT_STATUS_TONE: Record<TriageRow['status'], ChipTone> = {
  new: 'amber',
  acknowledged: 'neutral',
  resolved: 'teal',
};

export async function fetchTriage(): Promise<TriageRow[]> {
  const response = await fetch('/api/staff/alerts', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`alerts: ${response.status}`);
  return (await response.json()) as TriageRow[];
}

/** One shared query key: the dashboard card and the bell read the same
 * fetch, so one audited disclosure serves both. */
export const TRIAGE_QUERY = {
  queryKey: ['alerts', 'triage'],
  queryFn: fetchTriage,
  staleTime: 30_000,
};
