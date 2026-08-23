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
    role: 'treatment_lead',
  },
};
const MEMBER = {
  realm: 'staff' as const,
  account: {
    id: 's2',
    givenName: 'Mikael',
    familyName: 'Aho',
    locale: 'en' as const,
    role: 'treatment_member',
  },
};
const PATIENT = {
  realm: 'patient' as const,
  account: { id: 'p1', givenName: 'Anna', familyName: 'Virtanen', locale: 'en' as const },
};

const DETAIL = {
  id: 't1',
  patientId: 'p1',
  name: 'Breast ca adjuvant FEC',
  detail: '6 cycles, 3-week interval',
  state: 'draft',
  modifiedFromTemplate: false,
  template: { template_name: 'Breast ca adjuvant FEC', version: 2 },
  team: [
    {
      id: 'e1',
      staff_id: 's1',
      team_id: null,
      role: 'lead',
      staff_given: 'Elina',
      staff_family: 'Koskinen',
      title: 'Oncologist',
      team_name: null,
      team_size: null,
    },
    {
      id: 'e2',
      staff_id: null,
      team_id: 'tm1',
      role: 'member',
      staff_given: null,
      staff_family: null,
      title: null,
      team_name: 'Oncology ward 4',
      team_size: 12,
    },
  ],
  legalTransitions: ['active', 'discontinued'],
};

function appAt(path: string): { element: ReactElement } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  return {
    element: (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url === '/api/staff/templates') {
        return json([
          {
            id: 'tpl1',
            name: 'Breast ca adjuvant FEC',
            detail: '6 cycles',
            version_id: 'v2',
            version: 2,
            state: 'published',
            in_use: 12,
          },
          {
            id: 'tpl1',
            name: 'Breast ca adjuvant FEC',
            detail: '6 cycles',
            version_id: 'v3',
            version: 3,
            state: 'draft',
            in_use: 0,
          },
        ]);
      }
      if (url === '/api/staff/patients') return json([]);
      if (url === '/api/staff/treatments/t1') return json(DETAIL);
      if (url === '/api/staff/treatments/t1/activities') return json([]);
      if (url === '/api/staff/treatments/t1/tasks') return json([]);
      if (url === '/api/patient/treatments') {
        return json([
          {
            id: 't1',
            name: 'Breast cancer — adjuvant chemotherapy',
            detail: 'FEC, cycle 3 of 6',
            state: 'active',
            team: [
              { given_name: 'Elina', family_name: 'Koskinen', title: 'Oncologist', is_lead: true },
            ],
          },
          {
            id: 't0',
            name: 'Radiotherapy, breast',
            detail: '',
            state: 'completed',
            team: [{ given_name: 'Mikael', family_name: 'Aho', title: 'Nurse', is_lead: false }],
          },
        ]);
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('T2 catalog', () => {
  it('lists versions with states; only published rows offer Use for patient', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    const { element } = appAt('/treatments');
    const { container } = render(element);
    await screen.findByRole('heading', { name: 'Treatment catalog' });
    expect(await screen.findAllByText('Breast ca adjuvant FEC')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Use for patient' })).toHaveLength(1);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('T1 detail', () => {
  it('lead sees provenance, team incl. attached group, and transition buttons', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    const { element } = appAt('/treatments/t1');
    const { container } = render(element);
    await screen.findByRole('heading', { name: 'Breast ca adjuvant FEC' });
    await screen.findByText(/Instantiated from/);
    await screen.findByText('Team: Oncology ward 4 — 12 members');
    await screen.findByRole('button', { name: 'Activate' });
    await screen.findByRole('button', { name: 'Discontinue' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('a treatment member sees no lifecycle buttons', async () => {
    vi.mocked(api.whoami).mockResolvedValue(MEMBER);
    const { element } = appAt('/treatments/t1');
    render(element);
    await screen.findByRole('heading', { name: 'Breast ca adjuvant FEC' });
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });
});

describe('P5 patient treatments', () => {
  it('hides inactive by default and reveals on toggle', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    const { element } = appAt('/treatments');
    render(element);
    await screen.findByText('Breast cancer — adjuvant chemotherapy');
    expect(screen.queryByText('Radiotherapy, breast')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '1 inactive hidden — Show' }));
    await screen.findByText('Radiotherapy, breast');
  });
});
