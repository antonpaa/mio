import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import { routeTree } from '../../routes/route-tree.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
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

const VERSION = {
  id: 'v1',
  survey_id: 'srv1',
  version: 1,
  state: 'draft',
  name: 'Appetite check',
  kind: 'symptom',
  licensed_source: null,
  definition: {
    kind: 'symptom',
    pages: [
      {
        id: 'page-1',
        questions: [
          {
            id: 'q-1',
            type: 'choice_single',
            required: true,
            options: [{ id: 'o-1' }, { id: 'o-2' }],
            rules: [
              {
                id: 'r-1',
                when: { kind: 'option', optionId: 'o-2' },
                outcomes: [{ kind: 'alert', severity: 'high' }],
              },
            ],
            followUps: [
              {
                id: 'q-2',
                type: 'number',
                condition: { questionId: 'q-1', op: 'equals', value: 'o-2' },
                validation: { min: 0, max: 60, decimals: 0, unit: 'days' },
              },
            ],
          },
        ],
      },
    ],
    trendRules: [
      {
        id: 'r-9',
        when: {
          kind: 'repeat',
          questionId: 'q-1',
          match: { kind: 'option', optionId: 'o-2' },
          times: 3,
        },
        outcomes: [
          { kind: 'alert', severity: 'high' },
          { kind: 'notify', recipients: ['team'] },
        ],
      },
    ],
  },
  locales: [
    {
      locale: 'en',
      title: 'Appetite check',
      questions: {
        'q-1': { label: 'Appetite this week', options: { 'o-1': 'Normal', 'o-2': 'Reduced' } },
        'q-2': { label: 'For how many days?' },
      },
      rules: { 'r-9': { notifyText: 'Appetite has stayed reduced.' } },
    },
    { locale: 'fi', title: '', questions: {} },
    { locale: 'sv', title: '', questions: {} },
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url === '/api/staff/surveys') {
        return json([
          {
            id: 'srv1',
            name: 'Appetite check',
            kind: 'symptom',
            licensed_source: null,
            in_use: 3,
            versions: [
              { id: 'v2', version: 2, state: 'draft' },
              { id: 'v1', version: 1, state: 'published' },
            ],
          },
          {
            id: 'srv2',
            name: 'Quality of life (QLQ-30)',
            kind: 'generic',
            licensed_source: 'EORTC — licensed instrument',
            in_use: 1,
            versions: [{ id: 'v9', version: 1, state: 'published' }],
          },
        ]);
      }
      if (url === '/api/staff/surveys/versions/v1') return json(VERSION);
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('B1 catalog', () => {
  it('shows versions, usage and the licensing note; licensed rows get no new draft', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    const { container } = render(appAt('/surveys'));
    await screen.findByRole('heading', { name: 'Survey catalog' });
    await screen.findByText('Appetite check');
    expect(screen.getByText('v2 — Draft')).toBeTruthy();
    expect(screen.getAllByText('v1 — Published')).toHaveLength(2);
    expect(screen.getByText('Licensed instrument')).toBeTruthy();
    expect(screen.getByText('3 programs')).toBeTruthy();
    // srv1 has an open draft, srv2 is licensed - neither offers a new draft
    expect(screen.queryByRole('button', { name: 'New draft' })).toBeNull();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('B2/B4/B5 builder', () => {
  it('edits structure and text, tracks language gaps, previews with the live engine', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    const { container } = render(appAt('/surveys/builder/v1'));
    await screen.findByRole('heading', { name: 'Appetite check' });
    expect(screen.getByText('v1 — Draft')).toBeTruthy();
    // both questions render; the follow-up shows its condition editor
    expect(screen.getAllByDisplayValue('Appetite this week').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('For how many days?')).toBeTruthy();
    // the FI tab flags the missing texts (title + both labels)
    const fiTab = screen.getByRole('tab', { name: /FI/ });
    expect(fiTab.textContent).toContain('*3');

    // add a question - a fresh card with a minted id appears
    await userEvent.click(screen.getByRole('button', { name: '+ Add question' }));
    // the id shows on the new card AND in the trend panel's question select
    expect((await screen.findAllByText('q-3')).length).toBeGreaterThan(0);

    // the preview runs the REAL engine: the follow-up is hidden until the
    // gating option is chosen - and the verdict strip runs the REAL rule
    // evaluator: choosing the graded option announces the alert it would raise
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('For how many days?')).toBeNull();
    expect(within(dialog).getByText('No rule would fire')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Reduced' }));
    await within(dialog).findByText('For how many days?');
    expect(within(dialog).getByText(/would raise an alert/)).toBeTruthy();
    expect(within(dialog).getByText('High')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close preview' }));

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('the B2 rules panel edits conditions and outcomes, minting survey-unique ids', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    render(appAt('/surveys/builder/v1'));
    await screen.findByRole('heading', { name: 'Appetite check' });

    // the existing rule renders with its condition and outcome
    expect(screen.getByLabelText('Condition of rule r-1')).toHaveProperty('value', 'o-2');
    expect(screen.getByLabelText('Outcome of rule r-1')).toHaveProperty('value', 'high');
    expect(
      screen.getAllByText('Patients never see rules or severities.', { exact: false }).length,
    ).toBeGreaterThan(0);

    // adding a rule on the number follow-up mints the next free id (r-2)
    // and defaults to a threshold condition with a moderate alert
    const addButtons = screen.getAllByRole('button', { name: '+ Add rule' });
    await userEvent.click(addButtons[addButtons.length - 1]!);
    expect(await screen.findByLabelText('Comparison of rule r-2')).toHaveProperty(
      'value',
      'at_least',
    );
    expect(screen.getByLabelText('Outcome of rule r-2')).toHaveProperty('value', 'moderate');

    // record-only is a first-class outcome
    await userEvent.selectOptions(screen.getByLabelText('Outcome of rule r-2'), 'record');
    expect(screen.getByLabelText('Outcome of rule r-2')).toHaveProperty('value', 'record');
  });

  it('the B7 trend panel edits windows, outcomes and authored texts', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    render(appAt('/surveys/builder/v1'));
    await screen.findByRole('heading', { name: 'Appetite check' });

    // the fixture trend rule renders: repeat over q-1, x3, alert high +
    // notify team with its authored text
    expect(screen.getByText('Trend rules')).toBeTruthy();
    expect(screen.getByLabelText('Condition kind of rule r-9')).toHaveProperty('value', 'repeat');
    expect(screen.getByLabelText('Occurrence count of rule r-9')).toHaveProperty('value', '3');
    expect(screen.getByLabelText('Outcome of rule r-9')).toHaveProperty('value', 'high');
    expect(screen.getByDisplayValue('Appetite has stayed reduced.')).toBeTruthy();

    // switching the kind to missed drops the question controls
    await userEvent.selectOptions(screen.getByLabelText('Condition kind of rule r-9'), 'missed');
    expect(screen.getByLabelText('Condition kind of rule r-9')).toHaveProperty('value', 'missed');
    expect(screen.queryByLabelText('Question of rule r-9')).toBeNull();

    // a new trend rule mints the next free id in the SHARED namespace
    await userEvent.click(screen.getByRole('button', { name: '+ Add trend rule' }));
    expect(await screen.findByLabelText('Condition kind of rule r-2')).toHaveProperty(
      'value',
      'missed',
    );
  });

  it('publish asks for confirmation and states immutability', async () => {
    vi.mocked(api.whoami).mockResolvedValue(LEAD);
    render(appAt('/surveys/builder/v1'));
    await screen.findByRole('heading', { name: 'Appetite check' });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await screen.findByRole('alertdialog', { name: 'Publish this version?' });
    expect(screen.getByText(/immutable/)).toBeTruthy();
  });
});
