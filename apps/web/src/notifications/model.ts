/** WP-25 client model: one audited disclosure serves the page AND the
 * bell badge - shared query key, bounded staleness (the WP-19 bell and
 * WP-23 inbox precedent). */

export interface NotificationItem {
  id: string;
  kind: 'message.new' | 'rule.notify' | string;
  treatment_id: string | null;
  treatment_name: string | null;
  ref: { treatmentId?: string; messageId?: string; triggerId?: string };
  body: Record<string, string> | null;
  created_at: string;
  read_at: string | null;
  /** staff rows only: whose care the note concerns */
  patient_given?: string;
  patient_family?: string;
}

export interface NotificationsPayload {
  items: NotificationItem[];
  unread: number;
}

/** Both realms have a centre: the patient's own (P11) and the staff
 * one, where a B7 rule's team-addressed notification lands. Same
 * shape, same shared query key per realm - the bell badge and the page
 * ride one audited disclosure. */
export type NotificationRealm = 'patient' | 'staff';

export function notificationsQuery(realm: NotificationRealm) {
  return {
    queryKey: ['notifications', realm],
    queryFn: async (): Promise<NotificationsPayload> => {
      const response = await fetch(`/api/${realm}/notifications`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`notifications: ${response.status}`);
      return (await response.json()) as NotificationsPayload;
    },
    staleTime: 60_000,
    retry: false,
  } as const;
}

export const NOTIFICATIONS_QUERY = notificationsQuery('patient');
