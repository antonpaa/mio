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

const SETTINGS = {
  kinds: ['message.new', 'rule.notify', 'survey_reminder'],
  emailPrefs: { survey_reminder: false },
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
