import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url in ROUTES) {
        return new Response(JSON.stringify(ROUTES[url]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('P1/P7 patient landing', () => {
  it('greets and composes the four widgets from existing disclosures', async () => {
    const { container } = render(appAt('/'));
    await screen.findByText('Hello, Anna');
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
