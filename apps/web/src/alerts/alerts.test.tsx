import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const LEAD = {
  realm: 'staff' as const,
  account: {
    id: 's1',
    givenName: 'Elina',
    familyName: 'Koskinen',
    locale: 'en' as const,
    roles: ['clinician', 'author'],
  },
};

const TRIAGE = [
  {
    id: 'a1',
    severity: 'high',
    status: 'new',
    created_at: '2026-08-20T09:15:00Z',
    treatment_id: 't1',
    patient_id: 'p1',
    survey_response_id: 'r1',
    assignee_id: null,
    treatment_name: 'Prostate radiotherapy',
    patient_given: 'Aino',
    patient_family: 'Virtanen',
    assignee_given: null,
    assignee_family: null,
    survey_name: 'Weekly symptom survey',
    trigger_count: 2,
  },
  {
    id: 'a2',
    severity: 'moderate',
    status: 'acknowledged',
    created_at: '2026-08-19T14:00:00Z',
    treatment_id: 't2',
    patient_id: 'p2',
    survey_response_id: 'r2',
    assignee_id: 's2',
    treatment_name: 'Chemo cycle 2',
    patient_given: 'Juhani',
    patient_family: 'Mäkinen',
    assignee_given: 'Sofia',
    assignee_family: 'Nieminen',
    survey_name: 'Chemotherapy symptom survey',
    trigger_count: 1,
  },
];

const DETAIL = {
  alert: {
    id: 'a1',
    severity: 'high',
    status: 'new',
    created_at: '2026-08-20T09:15:00Z',
    treatment_id: 't1',
    patient_id: 'p1',
    survey_response_id: 'r1',
    assignee_id: null,
    treatment_name: 'Prostate radiotherapy',
    patient_given: 'Aino',
    patient_family: 'Virtanen',
    survey_name: 'Weekly symptom survey',
    submitted_at: '2026-08-20T09:14:00Z',
    assignee_given: null,
    assignee_family: null,
    assigned_at: null,
    assigned_by_given: null,
    assigned_by_family: null,
    acknowledged_at: null,
    acknowledged_given: null,
    acknowledged_family: null,
    resolved_at: null,
    resolved_given: null,
    resolved_family: null,
  },
  triggers: [
    {
      id: 'tr1',
      rule_id: 'r-nausea-severe',
      severity: 'high',
      fired_at: '2026-08-20T09:15:00Z',
      citation: {
        questionLabel: 'Nausea over the past week',
        kind: 'option',
        valueLabel: 'Severe',
      },
    },
    {
      id: 'tr2',
      rule_id: 'r-nausea-impact',
      severity: 'moderate',
      fired_at: '2026-08-20T09:15:00Z',
      citation: {
        questionLabel: 'How much did it affect your day?',
        kind: 'at_least',
        threshold: 7,
        observed: 9,
      },
    },
  ],
  comments: [
    {
      id: 'c1',
      body: 'Called the patient, arranging an extra visit.',
      created_at: '2026-08-20T10:00:00Z',
      author_given: 'Elina',
      author_family: 'Koskinen',
    },
  ],
  team: [
    { staff_id: 's1', is_lead: true, given_name: 'Elina', family_name: 'Koskinen', title: null },
    { staff_id: 's2', is_lead: false, given_name: 'Sofia', family_name: 'Nieminen', title: null },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

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
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url === '/api/staff/alerts') return json(TRIAGE);
    if (url === '/api/staff/alerts/a1' && init?.method === undefined) return json(DETAIL);
    if (url.startsWith('/api/staff/alerts/a1/')) return json({ status: 'ok' });
    if (url === '/api/staff/tasks') return json([]);
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('C1 triage queue and the bell', () => {
  it('lists open alerts with severity, patient and state; the bell counts NEW ones', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    const { container } = render(appAt('/'));
    await screen.findByText('Aino Virtanen');
    expect(screen.getByText('Triage queue')).toBeTruthy();
    expect(screen.getByText('2 open alerts')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('Sofia Nieminen')).toBeTruthy();
    // one NEW alert -> the bell announces exactly that
    expect(screen.getByRole('link', { name: '1 new alert' })).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('PP6 alert detail', () => {
  it('cites triggers, shows the timeline with comments, and acknowledges', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    const { container } = render(appAt('/alerts/a1'));
    await screen.findByRole('heading', { name: 'Aino Virtanen' });
    // trigger citations from the trace
    expect(screen.getByText('Nausea over the past week: “Severe”')).toBeTruthy();
    expect(screen.getByText('How much did it affect your day?: 9 (threshold ≥ 7)')).toBeTruthy();
    // the timeline: raised entry plus the appended comment
    expect(screen.getByText('Alert raised by rule — 2 triggers')).toBeTruthy();
    expect(screen.getByText('Comment — Elina Koskinen')).toBeTruthy();
    expect(screen.getByText('Called the patient, arranging an extra visit.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    const posted = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/staff/alerts/a1/acknowledge',
    );
    expect(posted).toBeTruthy();

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('resolving asks for confirmation and states finality', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    render(appAt('/alerts/a1'));
    await screen.findByRole('heading', { name: 'Aino Virtanen' });
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await screen.findByRole('alertdialog', { name: 'Resolve this alert?' });
    expect(screen.getByText(/final/)).toBeTruthy();
  });
});
