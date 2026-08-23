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

const CLINICIAN = {
  realm: 'staff' as const,
  account: {
    id: 's1',
    givenName: 'Elina',
    familyName: 'Koskinen',
    locale: 'en' as const,
    role: 'treatment_lead',
  },
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
  vi.mocked(api.whoami).mockResolvedValue(CLINICIAN);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/staff/patients') {
        return new Response(
          JSON.stringify([
            {
              patientId: 'p1',
              givenName: 'Anna',
              familyName: 'Virtanen',
              dateOfBirth: '1975-03-02',
              locale: 'fi',
            },
            {
              patientId: 'p2',
              givenName: 'Pekka',
              familyName: 'Laine',
              dateOfBirth: '1957-03-04',
              locale: 'fi',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === '/api/staff/patients/p1') {
        return new Response(
          JSON.stringify({
            patientId: 'p1',
            givenName: 'Anna',
            familyName: 'Virtanen',
            dateOfBirth: '1975-03-02',
            email: 'anna.virtanen@patient.example',
            phone: '+358 40 1234567',
            locale: 'fi',
            careTeamSize: 8,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('roster (C3 slice)', () => {
  it('lists patients, filters by search, and is axe-clean', async () => {
    const { element } = appAt('/patients');
    const { container } = render(element);
    await screen.findByText('Anna Virtanen');
    await screen.findByText('Pekka Laine');

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await userEvent.type(screen.getByRole('searchbox'), 'laine');
    expect(screen.queryByText('Anna Virtanen')).toBeNull();
    await screen.findByText('Pekka Laine');
  });
});

describe('patient profile (PP shell)', () => {
  it('renders the header and the grouped sub-navigation', async () => {
    const { element } = appAt('/patients/p1');
    const { container } = render(element);
    await screen.findByRole('heading', { name: 'Anna Virtanen' });
    await screen.findByText('Care team: 8 members');
    await screen.findByRole('navigation', { name: 'Patient sections' });
    await screen.findByText('Patient summary');
    await screen.findByText('Values');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
