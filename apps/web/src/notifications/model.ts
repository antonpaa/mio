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
}

export interface NotificationsPayload {
  items: NotificationItem[];
  unread: number;
}

export const NOTIFICATIONS_QUERY = {
  queryKey: ['notifications'],
  queryFn: async (): Promise<NotificationsPayload> => {
    const response = await fetch('/api/patient/notifications', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`notifications: ${response.status}`);
    return (await response.json()) as NotificationsPayload;
  },
  staleTime: 60_000,
  retry: false,
} as const;
