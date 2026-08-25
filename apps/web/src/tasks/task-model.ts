/** Shared task row shape + due-date bucketing (design C5). */

export interface TaskRow {
  id: string;
  treatment_id: string;
  patient_id: string;
  title: string;
  detail: string;
  due_date: string | null;
  status: 'open' | 'completed';
  assignee_id: string | null;
  treatment_name: string;
  patient_given: string;
  patient_family: string;
  assignee_given: string | null;
  assignee_family: string | null;
  /** the caller leads this task's treatment (complete is own OR team-lead) */
  viewer_is_lead?: boolean;
}

export interface StaffOption {
  staff_id: string;
  is_lead: boolean;
  given_name: string;
  family_name: string;
  title: string | null;
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later';

export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function bucketOf(dueDate: string | null, today: string): DueBucket {
  if (dueDate === null) return 'later';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const horizon = new Date(`${today}T12:00:00`);
  horizon.setDate(horizon.getDate() + 7);
  const week = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;
  return dueDate <= week ? 'week' : 'later';
}

export const BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'later'];
