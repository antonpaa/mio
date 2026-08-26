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

const PATIENT = {
  realm: 'patient' as const,
  account: { id: 'p1', givenName: 'Anna', familyName: 'Virtanen', locale: 'en' as const },
};

const DEFINITION = {
  kind: 'symptom',
  pages: [
    {
      id: 'symptoms',
      questions: [
        {
          id: 'nausea',
          type: 'choice_single',
          required: true,
          options: [{ id: 'none' }, { id: 'severe' }],
          followUps: [
            {
              id: 'nausea-frequency',
              type: 'choice_single',
              required: true,
              condition: { questionId: 'nausea', op: 'equals', value: 'severe' },
              options: [{ id: 'once' }, { id: 'twice-or-more' }],
            },
          ],
        },
        {
          id: 'temperature',
          type: 'text',
          validation: { pattern: '\\d{2}([.,]\\d)?', maxLength: 6 },
        },
      ],
    },
  ],
};

const BUNDLE = {
  locale: 'en',
  title: 'Weekly symptom survey',
  questions: {
    nausea: { label: 'Nausea over the past week', options: { none: 'None', severe: 'Severe' } },
    'nausea-frequency': {
      label: 'How often did nausea occur?',
      options: { once: 'Once', 'twice-or-more': '2 times or more' },
    },
    temperature: {
      label: 'Highest measured temperature (°C)',
      patternMessage: 'Give the temperature like 38.5',
    },
  },
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url === '/api/patient/surveys') {
        return json({
          due: [
            {
              activityId: 'a1',
              responseId: null,
              dueDate: '2020-01-05',
              overdue: true,
              title: 'Veckovis symtomenkät',
              treatmentName: 'Breast ca adjuvant FEC',
            },
          ],
          fillable: [
            {
              surveyId: 'srv1',
              treatmentId: 't1',
              treatmentName: 'Breast ca adjuvant FEC',
              kind: 'symptom',
              titles: { en: 'Weekly symptom survey', fi: 'Viikoittainen oirekysely' },
            },
          ],
          drafts: [
            {
              responseId: 'r0',
              title: 'Wellbeing check',
              progress: { answered: 1, total: 3 },
            },
          ],
          submitted: [],
        });
      }
      if (url === '/api/patient/responses/r1' && (!init || init.method === undefined)) {
        return json({
          responseId: 'r1',
          status: 'draft',
          kind: 'symptom',
          locale: 'en',
          definition: DEFINITION,
          bundle: BUNDLE,
          answers: {},
          progress: { answered: 0, total: 2 },
        });
      }
      if (url === '/api/patient/responses/r1/answers') return json({ progress: {} });
      if (url === '/api/patient/responses/r1/submit') return json({ status: 'submitted' });
      if (url === '/api/patient/responses/r2' && (!init || init.method === undefined)) {
        return json({
          responseId: 'r2',
          status: 'draft',
          kind: 'symptom',
          locale: 'en',
          definition: {
            kind: 'symptom',
            pages: [{ id: 'p', questions: [{ id: 'skin-map', type: 'body_map', required: true }] }],
          },
          bundle: {
            locale: 'en',
            title: 'Chemotherapy symptom survey',
            pageTitles: { p: 'Skin & nerves' },
            questions: { 'skin-map': { label: 'Mark where on the body' } },
          },
          answers: {},
          progress: { answered: 0, total: 1 },
        });
      }
      if (url === '/api/patient/responses/r2/answers') return json({ progress: {} });
      if (url === '/api/patient/responses/r3' && (!init || init.method === undefined)) {
        return json({
          responseId: 'r3',
          status: 'submitted',
          kind: 'symptom',
          locale: 'en',
          definition: DEFINITION,
          bundle: BUNDLE,
          answers: { nausea: 'severe' },
          submittedAt: '2026-08-20T10:00:00Z',
          progress: { answered: 1, total: 2 },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('P3 minimal list', () => {
  it('shows due, fillable and draft sections with the overdue chip', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    const { container } = render(appAt('/surveys'));
    await screen.findByRole('heading', { name: 'Surveys' });
    await screen.findByText('Weekly symptom survey');
    await screen.findByText('1 of 3');
    await screen.findByText('Veckovis symtomenkät');
    // the canvas chip counts the lateness (the fixture is years past due)
    expect(screen.getByText(/days overdue/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fill in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('P4 fill frame', () => {
  it('walks the branch, counts visible progress, and validates the pattern inline', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    const { container } = render(appAt('/surveys/fill/r1'));
    await screen.findByText('Nausea over the past week');
    // "0 of 2" - the follow-up is hidden
    await screen.findByText('0 of 2');

    // required: cannot continue without an answer
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('This question needs an answer.');

    await userEvent.click(screen.getByRole('radio', { name: 'Severe' }));
    // choosing 'severe' reveals the follow-up: total becomes 3
    await screen.findByText('1 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('How often did nausea occur?');
    await userEvent.click(screen.getByRole('radio', { name: '2 times or more' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // last question: authored pattern message on bad input, Submit on good
    await screen.findByText('Highest measured temperature (°C)');
    await userEvent.type(screen.getByRole('textbox'), 'hot');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Give the temperature like 38.5');

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('P12 submitted view', () => {
  it('leads with Done and keeps the answers behind Review', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    const { container } = render(appAt('/surveys/done/r3'));
    await screen.findByRole('heading', { name: 'Thank you — your answers are in' });
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    // X18(vii): calm first - the answers wait behind the disclosure
    expect(screen.queryByText('Nausea over the past week')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Review my answers' }));
    await screen.findByText('Nausea over the past week');
    expect(screen.getByText('Severe')).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('P4 body map', () => {
  it('the checkbox list and the summary carry the selection', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    const { container } = render(appAt('/surveys/fill/r2'));
    await screen.findByText('Mark where on the body');
    // X18(v): the page's section name is the category eyebrow
    await screen.findByText('Skin & nerves');
    await screen.findByText('No areas selected');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chest' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Left forearm' }));
    await screen.findByText('2 areas selected — Chest, Left forearm');
    // progress counts the now-valid answer
    await screen.findByText('1 of 1');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
