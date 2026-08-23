import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from 'react-intl';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import { routeTree } from '../routes/route-tree.js';
import { MESSAGES } from '../i18n/messages.js';
import { ScheduleDialog } from './schedule-dialog.js';
import { ActivitiesSection } from './activities-section.js';
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

const ACTIVITIES = [
  {
    id: 'a1',
    occurrence_date: '2026-09-15',
    title: 'PSA reporting',
    kind: 'survey',
    location: null,
    scheduled_at: null,
    status: 'planned',
    schedule_id: 'sch1',
  },
  {
    id: 'a2',
    occurrence_date: '2026-08-30',
    title: 'Oncologist visit',
    kind: 'visit',
    location: 'Clinic 2B',
    scheduled_at: '2026-08-30T07:30:00.000Z',
    status: 'confirmed',
    schedule_id: null,
  },
];

const CALENDAR = [
  {
    id: 'a2',
    occurrence_date: new Date().toISOString().slice(0, 10),
    title: 'Oncologist visit',
    kind: 'visit',
    location: 'Clinic 2B',
    scheduled_at: null,
    status: 'confirmed',
    treatment_name: 'Breast cancer — adjuvant chemotherapy',
  },
  {
    id: 'a3',
    occurrence_date: '2100-01-05',
    title: 'PSA reporting',
    kind: 'survey',
    location: null,
    scheduled_at: null,
    status: 'planned',
    treatment_name: 'Prostate ca follow-up',
  },
];

function wrap(element: ReactElement): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={MESSAGES.en} defaultLocale="en">
        {element}
      </IntlProvider>
    </QueryClientProvider>
  );
}

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
      if (url === '/api/staff/treatments/t1/activities') return json(ACTIVITIES);
      if (url === '/api/patient/calendar') return json(CALENDAR);
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('T3 recurrence dialog', () => {
  it('previews a phased rule with the shared expander', async () => {
    const { container } = render(
      wrap(<ScheduleDialog treatmentId="t1" onClose={() => {}} onCreated={() => {}} />),
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Phased' }));
    // default single phase: every 1 month x6 - preview appears
    const preview = await screen.findByTestId('schedule-preview');
    expect(within(preview).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText(/^Next: /)).toBeTruthy();
    expect(screen.getByText('6 occurrences within a year')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '+ Add phase' }));
    expect(screen.getByText('Phase 2')).toBeTruthy();
    // phase 2 defaults: every 3 months x4 - but only what fits in 365d shows
    expect(screen.getByText(/occurrences within a year/)).toBeTruthy();

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('posts a one-off activity in Once mode', async () => {
    const onCreated = vi.fn();
    render(wrap(<ScheduleDialog treatmentId="t1" onClose={() => {}} onCreated={onCreated} />));
    await userEvent.type(screen.getByLabelText('Title'), 'CT scan');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response('{"activityId":"a9"}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/treatments/t1/activities',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(onCreated).toHaveBeenCalled();
  });
});

describe('T1 activities section', () => {
  it('lists activities with status chips and legal actions only', async () => {
    const { container } = render(wrap(<ActivitiesSection treatmentId="t1" />));
    await screen.findByText('PSA reporting');
    // planned row: Confirm + Done + Cancel; confirmed row: Done + Cancel
    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(2);
    // the recurring marker is announced
    expect(screen.getAllByText('Recurring').length).toBeGreaterThan(0);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('P9 patient calendar', () => {
  it('groups by day with TODAY first and shows the treatment name', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    const { container } = render(appAt('/calendar'));
    await screen.findByRole('heading', { name: 'Calendar' });
    await screen.findByText('Today');
    await screen.findByText('Oncologist visit');
    await screen.findByText(/Breast cancer — adjuvant chemotherapy · Clinic 2B/);
    await screen.findByText('PSA reporting');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
