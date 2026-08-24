/**
 * WP-28: the administration plane's data layer. Identity metadata only -
 * every shape here mirrors what the admin API is allowed to say, and
 * nothing clinical has a field to arrive in.
 */

export interface StaffRow {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  role: 'treatment_member' | 'treatment_lead' | 'administrator';
  title: string | null;
  status: 'invited' | 'active' | 'deactivated';
}

export interface PatientRow {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  locale: string;
  status: 'invited' | 'active' | 'deactivated';
}

export interface TeamRow {
  id: string;
  name: string;
  members: { id: string; given_name: string; family_name: string; role: string }[];
}

export interface AuditEvent {
  occurred_at: string;
  actor: string;
  actor_realm: 'patient' | 'staff' | 'system' | null;
  action: string;
  resource_type: string;
  subject: string | null;
  decision: 'allow' | 'deny';
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.includes('step_up_required') ? 'step_up_required' : `${response.status}`);
  }
  return (await response.json()) as T;
}

export const usersQuery = {
  queryKey: ['admin-users'] as const,
  queryFn: () => getJson<{ staff: StaffRow[]; patients: PatientRow[] }>('/api/admin/users'),
};

export const teamsQuery = {
  queryKey: ['admin-teams'] as const,
  queryFn: () => getJson<TeamRow[]>('/api/admin/teams'),
};

export const rolesQuery = {
  queryKey: ['admin-roles'] as const,
  queryFn: () => getJson<{ roles: Record<string, string[]> }>('/api/admin/roles'),
};

export interface AuditFilters {
  from?: string;
  to?: string;
  action?: string;
  actor?: string;
}

export interface AuditPayload {
  events: AuditEvent[];
  range: { from: string; to: string };
  filters: { actions: string[]; actors: { id: string; name: string }[] };
}

export function auditSearch(filters: AuditFilters): string {
  const params = new URLSearchParams({ limit: '200' });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  return params.toString();
}

export function auditQueryFor(filters: AuditFilters) {
  const search = auditSearch(filters);
  return {
    queryKey: ['admin-audit', search] as const,
    queryFn: () => getJson<AuditPayload>(`/api/admin/audit?${search}`),
    // keep the previous page visible while a narrowed one loads: the
    // filter facets stay populated and the controls keep their values
    placeholderData: (previous: AuditPayload | undefined) => previous,
  };
}

export const auditQuery = auditQueryFor({});
