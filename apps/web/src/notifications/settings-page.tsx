import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import type { Locale } from '@mio/i18n';
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  IconAudit,
  IconPatients,
  IconSettings,
  Skeleton,
  Switch,
  TextField,
} from '@mio/ui';
import { useLocaleControls } from '../app/locale-context.js';

/**
 * P8 complete (WP-26): contact details and language, the per-type email
 * toggles (WP-25), and the privacy block the design treats as product -
 * "Who has viewed my records" and the data export. The page says why
 * the emails are safe and what the log shows, in the design's voice.
 */

interface SettingsPayload {
  kinds: string[];
  emailPrefs: Record<string, boolean>;
}

interface ProfilePayload {
  email: string;
  given_name: string;
  family_name: string;
  locale: Locale;
  phone: string;
  address: { street?: string; postalCode?: string; city?: string; country?: string };
  date_of_birth: string;
}

interface AccessEvent {
  action: string;
  resource_type: string;
  occurred_at: string;
  actor_given: string | null;
  actor_family: string | null;
  actor_title: string | null;
}

const KNOWN_RESOURCES = [
  'patient_clinical_profile',
  'message_thread',
  'message_inbox',
  'internal_note',
  'survey_response',
  'alert',
  'alert_triage',
  'value_series',
  'value_entry',
  'symptom_observation',
  'treatment',
  'task',
];

function EmailTogglesCard(): ReactElement {
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

  if (payload.isPending) return <Skeleton className="h-40 w-full" />;
  if (payload.isError) return <ErrorState onRetry={() => void payload.refetch()} />;

  const prefs = edits ?? payload.data.emailPrefs;
  const isOn = (kind: string): boolean => prefs[kind] !== false;
  const toggle = (kind: string, on: boolean): void => {
    const next = { ...prefs, [kind]: on };
    setEdits(next);
    save.mutate(next);
  };
  return (
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
  );
}

function ContactCard(): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { setLocale } = useLocaleControls();
  const [edits, setEdits] = useState<Record<string, string> | null>(null);
  const profile = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: async (): Promise<ProfilePayload> => {
      const response = await fetch('/api/patient/settings/profile', {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`profile: ${response.status}`);
      return (await response.json()) as ProfilePayload;
    },
    retry: false,
  });
  const save = useMutation({
    mutationFn: async (draft: Record<string, string>) => {
      const response = await fetch('/api/patient/settings/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          phone: draft['phone'],
          locale: draft['locale'],
          address: {
            street: draft['street'],
            postalCode: draft['postalCode'],
            city: draft['city'],
            ...(draft['country'] !== '' ? { country: draft['country'] } : {}),
          },
        }),
      });
      if (!response.ok) throw new Error(`profile: ${response.status}`);
    },
    onSuccess: (_, draft) => {
      setLocale(draft['locale'] as Locale);
      setEdits(null);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'profile'] });
    },
  });

  if (profile.isPending) return <Skeleton className="h-52 w-full" />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;

  const stored = profile.data;
  const draft = edits ?? {
    phone: stored.phone,
    street: stored.address.street ?? '',
    postalCode: stored.address.postalCode ?? '',
    city: stored.address.city ?? '',
    country: stored.address.country ?? '',
    locale: stored.locale,
  };
  const patch = (key: string, value: string): void => setEdits({ ...draft, [key]: value });

  return (
    <Card>
      <CardHeader
        icon={<IconPatients size={17} />}
        title={<FormattedMessage id="settings.contactSection" />}
      />
      <p className="mb-4 text-sm text-secondary">
        {stored.given_name} {stored.family_name} — {stored.email}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={intl.formatMessage({ id: 'settings.phone' })}
          value={draft['phone'] ?? ''}
          onChange={(value) => patch('phone', value)}
        />
        <TextField
          label={intl.formatMessage({ id: 'settings.street' })}
          value={draft['street'] ?? ''}
          onChange={(value) => patch('street', value)}
        />
        <TextField
          label={intl.formatMessage({ id: 'settings.postalCode' })}
          value={draft['postalCode'] ?? ''}
          onChange={(value) => patch('postalCode', value)}
        />
        <TextField
          label={intl.formatMessage({ id: 'settings.city' })}
          value={draft['city'] ?? ''}
          onChange={(value) => patch('city', value)}
        />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-strong-secondary">
          <FormattedMessage id="settings.language" />
          <select
            value={draft['locale']}
            onChange={(event) => patch('locale', event.target.value)}
            className="rounded-inner border border-border bg-surface px-3.5 py-2.5 text-sm font-normal text-ink"
          >
            <option value="en">English</option>
            <option value="fi">Suomi</option>
            <option value="sv">Svenska</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          onPress={() => save.mutate(draft)}
          isDisabled={edits === null || save.isPending}
        >
          <FormattedMessage id="settings.save" />
        </Button>
      </div>
    </Card>
  );
}

function PrivacyCard(): ReactElement {
  const intl = useIntl();
  const [exporting, setExporting] = useState(false);
  const history = useQuery({
    queryKey: ['settings', 'access-history'],
    queryFn: async (): Promise<{ events: AccessEvent[] }> => {
      const response = await fetch('/api/patient/privacy/access-history', {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`history: ${response.status}`);
      return (await response.json()) as { events: AccessEvent[] };
    },
    retry: false,
  });

  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const response = await fetch('/api/patient/privacy/export', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`export: ${response.status}`);
      const blob = new Blob([await response.text()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mio-export.json';
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<IconAudit size={17} />}
        title={<FormattedMessage id="settings.privacySection" />}
        action={
          <Button size="sm" variant="quiet" onPress={() => void download()} isDisabled={exporting}>
            <FormattedMessage id="settings.export" />
          </Button>
        }
      />
      <p className="mb-3 text-sm text-secondary">
        <FormattedMessage id="settings.accessWhy" />
      </p>
      {history.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : history.isError ? (
        <ErrorState onRetry={() => void history.refetch()} />
      ) : history.data.events.length === 0 ? (
        <p className="text-sm text-muted">
          <FormattedMessage id="settings.noAccess" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {history.data.events.slice(0, 8).map((event, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
              <span className="font-medium text-ink">
                {event.actor_given !== null
                  ? `${event.actor_given} ${event.actor_family ?? ''}`.trim()
                  : intl.formatMessage({ id: 'settings.unknownActor' })}
              </span>
              {event.actor_title !== null && event.actor_title !== '' ? (
                <span className="text-xs text-muted">{event.actor_title}</span>
              ) : null}
              <span className="min-w-0 flex-1 text-secondary">
                {KNOWN_RESOURCES.includes(event.resource_type)
                  ? intl.formatMessage({ id: `settings.viewed.${event.resource_type}` })
                  : intl.formatMessage({ id: 'settings.viewed.generic' })}
              </span>
              <span className="text-xs text-muted">
                {intl.formatDate(event.occurred_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SettingsPage(): ReactElement {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="settings.title" />
      </h1>
      <ContactCard />
      <EmailTogglesCard />
      <PrivacyCard />
    </div>
  );
}
