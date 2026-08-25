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

const FILL_PAYLOAD = {
  responseId: 'r9',
  status: 'draft',
  locale: 'en',
  kind: 'generic',
  definition: {
    kind: 'generic',
    pages: [
      {
        id: 'p1',
        questions: [
          {
            id: 'nausea',
            type: 'choice_single',
            required: true,
            options: [{ id: 'none' }, { id: 'severe' }],
          },
        ],
      },
    ],
  },
  bundle: {
    locale: 'en',
    title: 'Weekly symptom survey',
    questions: {
      nausea: {
        label: 'Nausea in the last week',
        options: { none: 'None', severe: 'Severe' },
      },
    },
  },
  answers: {},
  progress: { answered: 0, total: 1 },
  submittedAt: null,
  patient: { given_name: 'Anna', family_name: 'Virtanen' },
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
  vi.mocked(api.whoami).mockResolvedValue(CLINICIAN);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (value: unknown, status = 200): Response =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url === '/api/staff/responses/r9/fill') return json(FILL_PAYLOAD);
    if (url === '/api/staff/patients/p1/fillable') {
      return json([
        {
          activity_id: 'act1',
          treatment_id: 't1',
          survey_id: 'sv1',
          survey_name: 'Weekly symptom survey',
          treatment_name: 'Chemo cycle 2',
          due_date: '2026-08-20',
          draft_id: null,
        },
      ]);
    }
    if (url === '/api/staff/patients/p1/responses' && init?.method === 'POST') {
      return json({ responseId: 'r9' }, 201);
    }
    if (init?.method === 'POST') return json({ ok: true });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('on-behalf survey fill', () => {
  it('says whose answers these are, and submits through the staff realm', async () => {
    const { container } = render(appAt('/patients/p1/fill/r9'));
    await screen.findByText('Weekly symptom survey');
    // the banner is the safety rail: never let it be mistaken for the
    // patient's own entry
    expect(screen.getByText('Entering on behalf of the patient')).toBeTruthy();
    expect(screen.getByText(/Record the answers as the patient gave them/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Severe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url) === '/api/staff/responses/r9/submit',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call![1] as RequestInit).body)) as {
        answers: Record<string, unknown>;
      };
      expect(body.answers['nausea']).toBe('severe');
    });

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
