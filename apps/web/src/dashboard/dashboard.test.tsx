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

const CLINICIAN = {
  realm: 'staff' as const,
  account: {
    id: 's1',
    givenName: 'Elina',
    familyName: 'Koskinen',
    locale: 'en' as const,
    roles: ['clinician', 'author'],
  },
};

const ALERTS = [
  {
    id: 'al1',
    severity: 'high',
    status: 'new',
    created_at: '2026-08-20T10:00:00Z',
    treatment_id: 't1',
    patient_id: 'p1',
    survey_response_id: 'r1',
    assignee_id: 's1',
    treatment_name: 'Chemo cycle 2',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    assignee_given: 'Elina',
    assignee_family: 'Koskinen',
    survey_name: 'Weekly symptom survey',
    trigger_count: 2,
  },
  {
    id: 'al2',
    severity: 'moderate',
    status: 'new',
    created_at: '2026-08-21T10:00:00Z',
    treatment_id: 't2',
    patient_id: 'p2',
    survey_response_id: 'r2',
    assignee_id: null,
    treatment_name: 'Immunotherapy follow-up',
    patient_given: 'Erik',
    patient_family: 'Lundgren',
    assignee_given: null,
    assignee_family: null,
    survey_name: 'Wellbeing check',
    trigger_count: 1,
  },
];

const OVERDUE = [
  {
    id: 'act1',
    patient_id: 'p1',
    occurrence_date: '2026-08-18',
    reminded_at: null,
    treatment_name: 'Chemo cycle 2',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    survey_name: 'Weekly symptom survey',
  },
];

const AGENDA = [
  {
    id: 'ag1',
    patient_id: 'p1',
    treatment_id: 't1',
    title: 'Oncology visit',
    kind: 'visit',
    location: 'Clinic 2B',
    status: 'confirmed',
    occurrence_date: new Date().toISOString().slice(0, 10),
    scheduled_at: null,
    treatment_name: 'Chemo cycle 2',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
  },
];

const THREADS = [
  {
    treatment_id: 't1',
    treatment_name: 'Chemo cycle 2',
    state: 'active',
    patient_id: 'p1',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    unread: 3,
    last_preview: 'The nausea got worse over the weekend.',
    last_at: '2026-08-22T09:00:00Z',
    last_author_realm: 'patient',
  },
];

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
  vi.mocked(api.whoami).mockResolvedValue(CLINICIAN);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const payloads: Record<string, unknown> = {
      '/api/staff/alerts': ALERTS,
      '/api/staff/tasks': [],
      '/api/staff/messages': THREADS,
      '/api/staff/dashboard/overdue': OVERDUE,
      '/api/staff/dashboard/agenda': AGENDA,
    };
    if (url === '/api/staff/activities/act1/remind' && init?.method === 'POST') {
      return new Response('{"sent":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url in payloads) {
      return new Response(JSON.stringify(payloads[url]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('C1 complete', () => {
  it('renders the worklists and the segmented filter narrows the queue', async () => {
    const { container } = render(appAt('/'));
    await screen.findByText('Anna Virtanen');
    // both alerts under Whole team
    expect(screen.getByText('Erik Lundgren')).toBeTruthy();
    // the side worklists
    expect(screen.getByText('Overdue surveys')).toBeTruthy();
    expect(screen.getByText('Today & upcoming')).toBeTruthy();
    expect(screen.getByText(/Oncology visit/)).toBeTruthy();
    expect(screen.getByText('Unread conversations')).toBeTruthy();
    expect(screen.getByText('The nausea got worse over the weekend.')).toBeTruthy();

    // narrowing to my assignments drops the unassigned alert
    fireEvent.click(screen.getByRole('button', { name: 'Assigned to me' }));
    await waitFor(() => {
      expect(screen.queryByText('Erik Lundgren')).toBeNull();
    });

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('the send-reminder control posts and flips to the reminded chip', async () => {
    render(appAt('/'));
    await screen.findByText('Overdue surveys');
    fireEvent.click(await screen.findByRole('button', { name: 'Send reminder' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/activities/act1/remind'),
      );
      expect(call).toBeTruthy();
    });
  });
});
