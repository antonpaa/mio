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

const FUTURE = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

const ROUTES: Record<string, unknown> = {
  '/api/patient/surveys': {
    due: [
      {
        activityId: 'a1',
        responseId: null,
        dueDate: '2026-08-20',
        overdue: true,
        title: 'Weekly symptom survey',
        treatmentName: 'Chemo cycle 2',
      },
    ],
    fillable: [],
    drafts: [{ responseId: 'r1', title: 'Wellbeing check' }],
    submitted: [],
  },
  '/api/patient/messages': [
    {
      treatment_id: 't1',
      treatment_name: 'Chemo cycle 2',
      state: 'active',
      unread: 2,
      last_preview: 'We saw your answers.',
      last_at: '2026-08-20T09:00:00Z',
      last_author_realm: 'staff',
    },
  ],
  '/api/patient/notifications': {
    items: [
      {
        id: 'n1',
        kind: 'rule.notify',
        treatment_id: 't1',
        treatment_name: 'Chemo cycle 2',
        ref: {},
        body: { en: 'Because nausea has increased, your care team has been notified.' },
        created_at: '2026-08-21T10:00:00Z',
        read_at: null,
      },
    ],
    unread: 1,
  },
  '/api/patient/calendar': [
    {
      id: 'c1',
      occurrence_date: null,
      scheduled_at: FUTURE,
      title: 'Oncology visit',
      kind: 'visit',
      location: 'Clinic 2B',
      status: 'confirmed',
      treatment_name: 'Chemo cycle 2',
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

beforeEach(() => {
  vi.mocked(api.whoami).mockResolvedValue(PATIENT);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/patient/symptoms' && init?.method === 'POST') {
      return new Response('{"observationId":"o1"}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/patient/symptoms') {
      return new Response(
        JSON.stringify({
          taxonomy: [
            {
              id: 'sy1',
              code: 'headache',
              label_en: 'Headache',
              label_fi: 'Päänsärky',
              label_sv: 'Huvudvärk',
            },
          ],
          own: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url in ROUTES) {
      return new Response(JSON.stringify(ROUTES[url]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

let fetchMock: ReturnType<typeof vi.fn>;

describe('P1/P7 patient landing', () => {
  it('greets and composes the four widgets from existing disclosures', async () => {
    const { container } = render(appAt('/'));
    await screen.findByText(/Good (morning|afternoon|evening), Anna/);
    // Action needed: the overdue survey and the draft
    expect(screen.getByText('Action needed')).toBeTruthy();
    expect(screen.getByText('Weekly symptom survey')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Wellbeing check')).toBeTruthy();
    // Messages: the unread thread with its preview
    expect(screen.getByText('We saw your answers.')).toBeTruthy();
    // Updates: the authored note text
    expect(
      screen.getByText('Because nausea has increased, your care team has been notified.'),
    ).toBeTruthy();
    // Upcoming: the visit with its location after the dash
    expect(screen.getByText(/Oncology visit/)).toBeTruthy();
    expect(screen.getByText(/Clinic 2B/)).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('X7 self-report', () => {
  it('reports a symptom from the landing and lands the calm confirmation', async () => {
    render(appAt('/'));
    await screen.findByText(/Good (morning|afternoon|evening), Anna/);
    fireEvent.click(screen.getByRole('button', { name: /Report a symptom/ }));
    // wait for the taxonomy to load into the select before choosing
    await screen.findByRole('option', { name: 'Headache' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sy1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Moderate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to your care team' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === '/api/patient/symptoms' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect(String((post![1] as RequestInit).body)).toContain('"severity":"moderate"');
    });
    await screen.findByText(/Thank you/);
  });
});
