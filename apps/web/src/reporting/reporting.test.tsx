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

const OVERVIEW = {
  windowDays: 30,
  surveys: { due: 47, completed: 41, ratePercent: 87, deltaPoints: 3 },
  alerts: { openNow: 11, openHigh: 3, oldestHighDays: 2, medianAckHours: 2.4 },
  programs: [
    {
      program: 'Breast ca adjuvant FEC',
      patients: 12,
      due: 13,
      completed: 12,
      ratePercent: 92,
      openAlerts: 4,
      openHigh: 2,
      openModerate: 1,
    },
    {
      program: 'Immunotherapy follow-up',
      patients: 5,
      due: 7,
      completed: 5,
      ratePercent: 71,
      openAlerts: 4,
      openHigh: 0,
      openModerate: 4,
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
  vi.mocked(api.whoami).mockResolvedValue(CLINICIAN);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/staff/reporting') {
        return new Response(JSON.stringify(OVERVIEW), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

describe('A4 reporting (P8: clinical side)', () => {
  it('renders the three stat cards and the per-programme table, axe-clean', async () => {
    const { container } = render(appAt('/reporting'));
    await screen.findByText('87%');
    expect(screen.getByText('+3 points vs previous 30 days')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('3 high — oldest 2 days')).toBeTruthy();
    expect(screen.getByText('2.4 h')).toBeTruthy();
    expect(screen.getByText('Breast ca adjuvant FEC')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText('2 high')).toBeTruthy();
    expect(screen.getByText('4 moderate')).toBeTruthy();

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('gives an administrator the placeholder, never the metrics', async () => {
    vi.mocked(api.whoami).mockResolvedValue({
      realm: 'staff' as const,
      account: {
        id: 'a1',
        givenName: 'Hanna',
        familyName: 'Korpela',
        locale: 'en' as const,
        role: 'administrator',
      },
    });
    render(appAt('/reporting'));
    // the admin shell renders, but the page body is the shared placeholder
    await screen.findByText('All caught up');
    expect(screen.queryByText('87%')).toBeNull();
    expect(screen.queryByText('Breast ca adjuvant FEC')).toBeNull();
  });
});
