import type { MessageDoc } from '@mio/contracts';

/** WP-23 client model: the thread list is ONE audited disclosure shared
 * by the page and the nav badge (the WP-19 bell precedent), so it lives
 * behind a single query key per realm. */

export interface ThreadRow {
  treatment_id: string;
  treatment_name: string;
  state: string;
  unread: number;
  last_preview: string | null;
  last_at: string | null;
  last_author_realm: 'patient' | 'staff' | null;
  /** X17(d): who wrote the previewed message - the lists prefix it */
  last_author_id: string | null;
  last_author_given: string | null;
  /** patient list only: the treatment's care team, for P10's line */
  team_name?: string | null;
  patient_id?: string;
  patient_given?: string;
  patient_family?: string;
  readOnly?: boolean;
}

export interface TimelineItem {
  kind: 'message' | 'note';
  id: string;
  author_id: string;
  author_realm: 'patient' | 'staff';
  author_given: string | null;
  author_family: string | null;
  body: MessageDoc;
  created_at: string;
}

export interface ThreadDetail {
  treatment: {
    id: string;
    name: string;
    state: string;
    patient_id?: string;
    patient_given?: string;
    patient_family?: string;
  };
  readOnly: boolean;
  items: TimelineItem[];
  alerts?: {
    id: string;
    severity: 'low' | 'moderate' | 'high';
    status: string;
    created_at: string;
    survey_name: string | null;
  }[];
}

export function messagesBase(realm: 'patient' | 'staff'): string {
  return `/api/${realm}/messages`;
}

export function threadsQuery(realm: 'patient' | 'staff') {
  return {
    queryKey: ['messages', realm],
    queryFn: async (): Promise<ThreadRow[]> => {
      const response = await fetch(messagesBase(realm), { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`messages: ${response.status}`);
      return (await response.json()) as ThreadRow[];
    },
    // bounds how often the shared badge re-discloses the inbox
    staleTime: 60_000,
    retry: false,
  };
}
