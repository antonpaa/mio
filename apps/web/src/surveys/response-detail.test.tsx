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

const DETAIL = {
  response: {
    id: 'r1',
    status: 'submitted',
    locale: 'en',
    submitted_at: '2026-08-20T09:14:00Z',
    answers: { nausea: 'severe', 'nausea-impact': 6, fatigue: 'none' },
    treatment_id: 't1',
    patient_id: 'p1',
    version: 1,
    treatment_name: 'Chemo cycle 2',
    survey_name: 'Weekly symptom survey',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    behalf_given: null,
    behalf_family: null,
  },
  definition: {
    pages: [
      {
        id: 'page-1',
        questions: [
          {
            id: 'nausea',
            type: 'choice_single',
            options: [{ id: 'none' }, { id: 'severe' }],
          },
          { id: 'nausea-impact', type: 'scale', scale: { min: 0, max: 10 } },
          {
            id: 'fatigue',
            type: 'choice_single',
            options: [{ id: 'none' }, { id: 'considerable' }],
          },
        ],
      },
    ],
  },
  locales: [
    {
      locale: 'en',
      title: 'Weekly symptom survey',
      questions: {
        nausea: { label: 'Nausea', options: { none: 'None', severe: 'Severe' } },
        'nausea-impact': { label: 'Impact on your day' },
        fatigue: { label: 'Fatigue', options: { none: 'None', considerable: 'Considerable' } },
      },
    },
  ],
  overrides: { rules: { 'r-nausea-impact': { value: 5 } } },
  standing: { nausea: 'above_expected', 'nausea-impact': 'above_expected' },
  triggers: [
    {
      id: 'tr1',
      rule_id: 'r-nausea-impact',
      severity: 'moderate',
      source: 'program',
      citation: {
        questionLabel: 'Impact on your day',
        kind: 'at_least',
        threshold: 5,
        observed: 6,
      },
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
      if (url === '/api/staff/responses/r1') {
        return new Response(JSON.stringify(DETAIL), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/staff/alerts') {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('C7 response detail', () => {
  it('shows per-answer standing against the program rules with the context line', async () => {
    const { container } = render(appAt('/responses/r1'));
    await screen.findByRole('heading', { name: 'Weekly symptom survey' });
    // the program adjusted one rule - the context line says so
    expect(screen.getByText(/1 adjustment over the template/)).toBeTruthy();
    // standings: severe nausea + tightened impact are above expected,
    // fatigue "None" is expected in this program
    expect(screen.getAllByText('Above expected')).toHaveLength(2);
    expect(screen.getByText('Expected in this program')).toBeTruthy();
    // the trigger cites the PROGRAM layer
    expect(screen.getByText('Impact on your day: 6 (≥ 5)')).toBeTruthy();
    expect(screen.getByText('Program')).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
