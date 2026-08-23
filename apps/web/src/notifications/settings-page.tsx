import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage } from 'react-intl';
import { Card, CardHeader, ErrorState, IconSettings, Skeleton, Switch } from '@mio/ui';

/**
 * P8, the WP-25 slice: per-type EMAIL toggles, all on by default. Only
 * the contentless nudge is optional - in-app delivery is not - and the
 * page says why the emails are safe to keep on. The rest of P8 (contact
 * info, formats, access history, export) arrives with WP-26.
 */

interface SettingsPayload {
  kinds: string[];
  emailPrefs: Record<string, boolean>;
}

export function SettingsPage(): ReactElement {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, boolean> | null>(null);
  const payload = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: async (): Promise<SettingsPayload> => {
      const response = await fetch('/api/patient/settings/notifications', {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`settings: ${response.status}`);
      return (await response.json()) as SettingsPayload;
    },
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (prefs: Record<string, boolean>) => {
      const response = await fetch('/api/patient/settings/notifications', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ emailPrefs: prefs }),
      });
      if (!response.ok) throw new Error(`settings: ${response.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'notifications'] });
    },
  });

  if (payload.isPending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (payload.isError) return <ErrorState onRetry={() => void payload.refetch()} />;

  const stored = payload.data.emailPrefs;
  const prefs = edits ?? stored;
  const isOn = (kind: string): boolean => prefs[kind] !== false;
  const toggle = (kind: string, on: boolean): void => {
    const next = { ...prefs, [kind]: on };
    setEdits(next);
    save.mutate(next);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="settings.title" />
      </h1>
      <Card>
        <CardHeader
          icon={<IconSettings size={17} />}
          title={<FormattedMessage id="settings.emailSection" />}
        />
        <p className="mb-4 text-sm text-secondary">
          <FormattedMessage id="settings.emailWhy" />
        </p>
        <ul className="flex flex-col gap-4">
          {payload.data.kinds.map((kind) => (
            <li key={kind}>
              <Switch
                isSelected={isOn(kind)}
                onChange={(on) => toggle(kind, on)}
                label={<FormattedMessage id={`settings.emailKind.${kind}`} />}
              />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
