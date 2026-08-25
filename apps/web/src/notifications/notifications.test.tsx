import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import { routeTree } from '../routes/route-tree.js';
import * as api from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  login: vi.fn(),
  verifyOtp: vi.fn(),
  resendOtp: vi.fn(),
  whoami: vi.fn(async () => null),
  logout: vi.fn(),
  inspectInvite: vi.fn(),
  acceptInvite: vi.fn(),
  requestReset: vi.fn(async () => {}),
  completeReset: vi.fn(),
}));

const PATIENT = {
  realm: 'patient' as const,
  account: { id: 'p1', givenName: 'Anna', familyName: 'Virtanen', locale: 'en' as const },
};

const CENTRE = {
  items: [
    {
      id: 'n1',
      kind: 'rule.notify',
      treatment_id: 't1',
      treatment_name: 'Chemo cycle 2',
      ref: { triggerId: 'tr1', treatmentId: 't1' },
      body: {
        en: 'Because nausea has increased, your care team has been notified.',
        fi: 'Koska pahoinvointi on lisääntynyt, hoitotiimillesi on ilmoitettu.',
      },
      created_at: '2026-08-21T10:00:00Z',
      read_at: null,
    },
    {
      id: 'n2',
      kind: 'message.new',
      treatment_id: 't1',
      treatment_name: 'Chemo cycle 2',
      ref: { treatmentId: 't1', messageId: 'm1' },
      body: null,
      created_at: '2026-08-20T09:00:00Z',
      read_at: '2026-08-20T10:00:00Z',
    },
  ],
  unread: 1,
};

const STAFF_CENTRE = {
  items: [
    {
      id: 'sn1',
      kind: 'rule.notify',
      treatment_id: 't1',
      treatment_name: 'Chemo cycle 2',
      patient_given: 'Anna',
      patient_family: 'Virtanen',
      ref: { triggerId: 'tr1', treatmentId: 't1' },
      body: { en: 'Nausea has increased for three surveys running.' },
      created_at: '2026-08-21T10:00:00Z',
      read_at: null,
    },
  ],
  unread: 1,
};

const SETTINGS = {
  kinds: ['message.new', 'rule.notify', 'survey_reminder'],
  emailPrefs: { survey_reminder: false },
};

const PROFILE = {
  email: 'anna.virtanen.0@patient.example',
  given_name: 'Anna',
  family_name: 'Virtanen',
  locale: 'en',
  phone: '+358 40 1234567',
  address: { street: 'Testikatu 1', postalCode: '00100', city: 'Helsinki', country: 'FI' },
  date_of_birth: '1971-02-03',
};

const ACCESS_HISTORY = {
  events: [
    {
      action: 'patient_clinical_profile.view',
      resource_type: 'patient_clinical_profile',
      occurred_at: '2026-08-22T09:00:00Z',
      actor_given: 'Elina',
      actor_family: 'Koskinen',
      actor_title: 'Oncologist',
    },
  ],
};

function appAt(path: string): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(api.whoami).mockResolvedValue(PATIENT);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/staff/notifications') {
      return new Response(JSON.stringify(STAFF_CENTRE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/notifications') {
      return new Response(JSON.stringify(CENTRE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/settings/notifications' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(SETTINGS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/settings/notifications' && init?.method === 'PUT') {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/patient/settings/profile' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(PROFILE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/privacy/access-history') {
      return new Response(JSON.stringify(ACCESS_HISTORY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/notifications/read') {
      return new Response('{"marked":1}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/messages') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('P11 notification centre', () => {
  it('renders authored notes in the reader language, references for messages, and the bell badge', async () => {
    const { container } = render(appAt('/notifications'));
    await screen.findByText('Because nausea has increased, your care team has been notified.');
    // the rule note carries its label; the message renders a reference
    expect(screen.getByText('About your answers')).toBeTruthy();
    expect(screen.getByText('New message — Chemo cycle 2')).toBeTruthy();
    // the explainer states the email boundary in the interface
    expect(screen.getByText(/Emails only say something is waiting/)).toBeTruthy();
    // one unread: the bell badge (desktop + mobile menu render the end
    // slot twice) and the mark-all button both show
    expect(screen.getAllByLabelText('Notifications — 1 unread').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('P8 email toggles', () => {
  it('shows the per-type switches from stored prefs and saves a flip', async () => {
    const { container } = render(appAt('/settings'));
    await screen.findByText('Email notifications');
    // WP-26: the completed P8 renders contact and privacy beside them
    await screen.findByText('Contact details');
    await screen.findByText(/Elina Koskinen/);
    expect(screen.getByText('viewed your records')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeTruthy();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    // survey_reminder was stored off
    expect(screen.getByRole('switch', { name: 'Survey reminders' })).toHaveProperty(
      'checked',
      false,
    );
    expect(screen.getByRole('switch', { name: 'New message' })).toHaveProperty('checked', true);

    fireEvent.click(screen.getByRole('switch', { name: 'New message' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      expect(String((put![1] as RequestInit).body)).toContain('"message.new":false');
    });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('the staff notification centre', () => {
  it('shows a team-addressed rule note, names whose care it concerns, and is axe-clean', async () => {
    vi.mocked(api.whoami).mockResolvedValue({
      realm: 'staff' as const,
      account: {
        id: 's1',
        givenName: 'Elina',
        familyName: 'Koskinen',
        locale: 'en' as const,
        role: 'treatment_lead',
      },
    });
    const { container } = render(appAt('/notifications'));
    await screen.findByText('Nausea has increased for three surveys running.');
    // staff voice, not the patient's: this came from a rule, about someone
    expect(screen.getByText('From a survey rule')).toBeTruthy();
    expect(screen.getByText('About Anna Virtanen — Chemo cycle 2')).toBeTruthy();
    expect(screen.getByText(/a survey rule addressed to your care team/)).toBeTruthy();
    // and it never borrows the patient-facing email explainer
    expect(screen.queryByText(/Emails only say something is waiting/)).toBeNull();

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
