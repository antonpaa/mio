import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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

const PROFILE = {
  patientId: 'p1',
  givenName: 'Anna',
  familyName: 'Virtanen',
  dateOfBirth: '1975-03-02',
  email: 'anna@patient.example',
  phone: null,
  locale: 'fi',
  careTeamSize: 3,
};

const VALUES = [
  {
    id: 'ser1',
    key: 'psa',
    name: 'PSA value',
    unit: 'µg/l',
    kind: 'numeric',
    trend: 'rising',
    latest: [
      {
        id: 'e3',
        value: 5.1,
        measured_at: '2026-08-01',
        note: '',
        on_behalf_of_patient: false,
        entered_given: null,
        entered_family: null,
      },
      {
        id: 'e2',
        value: 4.4,
        measured_at: '2026-07-01',
        note: '',
        on_behalf_of_patient: true,
        entered_given: 'Elina',
        entered_family: 'Koskinen',
      },
    ],
  },
];

const SYMPTOMS = {
  register: [
    {
      code: 'nausea',
      symptomId: 'y1',
      labels: { en: 'Nausea', fi: 'Pahoinvointi', sv: 'Illamående' },
      trend: 'worsening',
      count: 4,
      latest: {
        severity: 'severe',
        observed_at: '2026-08-20',
        source: 'survey',
        on_behalf_of_patient: false,
        entered_given: null,
        entered_family: null,
        detail: {},
      },
    },
    {
      code: 'skin_change',
      symptomId: 'y2',
      labels: { en: 'Rash / skin change', fi: 'Ihomuutos', sv: 'Hudförändring' },
      trend: 'new',
      count: 1,
      latest: {
        severity: 'moderate',
        observed_at: '2026-08-18',
        source: 'clinician',
        on_behalf_of_patient: true,
        entered_given: 'Elina',
        entered_family: 'Koskinen',
        detail: { regions: ['chest'] },
      },
    },
  ],
  taxonomy: [
    {
      id: 'y1',
      code: 'nausea',
      label_en: 'Nausea',
      label_fi: 'Pahoinvointi',
      label_sv: 'Illamående',
    },
    {
      id: 'y3',
      code: 'joint_pain',
      label_en: 'Joint pain',
      label_fi: 'Nivelkipu',
      label_sv: 'Ledvärk',
    },
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
  vi.mocked(api.whoami).mockResolvedValue(CLINICIAN);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url === '/api/staff/patients/p1') return json(PROFILE);
    if (url === '/api/staff/patients/p1/treatments') return json([]);
    if (url === '/api/staff/patients/p1/values') return json(VALUES);
    if (url === '/api/staff/patients/p1/symptoms' && init?.method === undefined)
      return json(SYMPTOMS);
    if (url === '/api/staff/patients/p1/symptoms' && init?.method === 'POST')
      return json({ observationId: 'o9' });
    if (url === '/api/staff/alerts') return json([]);
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('PP2 values card', () => {
  it('shows series with trend label and latest entries', async () => {
    const { container } = render(appAt('/patients/p1'));
    await screen.findByText('PSA value');
    expect(screen.getByText('→ Rising'.replace('→', '↑'))).toBeTruthy();
    expect(screen.getByText(/5\.1 µg\/l/)).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('PP3 symptom register', () => {
  it('renders grades, trends, provenance and body-map regions', async () => {
    render(appAt('/patients/p1'));
    await screen.findByText('Nausea');
    expect(screen.getByText('Severe')).toBeTruthy();
    expect(screen.getByText('Worsening')).toBeTruthy();
    expect(screen.getByText('Survey')).toBeTruthy();
    // clinician on-behalf provenance is spelled out
    expect(screen.getByText('Elina Koskinen, on behalf')).toBeTruthy();
    // body-map detail renders localized region names
    expect(screen.getByText('Chest')).toBeTruthy();
  });

  it('reports a symptom on behalf through the dialog', async () => {
    render(appAt('/patients/p1'));
    await screen.findByText('Nausea');
    await userEvent.click(screen.getByRole('button', { name: 'Report a symptom' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/on behalf of the patient/)).toBeTruthy();
    await userEvent.selectOptions(within(dialog).getByLabelText('Symptom'), 'y3');
    await userEvent.selectOptions(within(dialog).getByLabelText('Severity'), 'mild');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save observation' }));
    const posted = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/staff/patients/p1/symptoms' && call[1]?.method === 'POST',
    );
    expect(posted).toBeTruthy();
    expect(String(posted![1]!.body)).toContain('"severity":"mild"');
  });
});
