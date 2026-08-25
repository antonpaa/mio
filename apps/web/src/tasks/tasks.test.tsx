import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import { routeTree } from '../routes/route-tree.js';
import { localToday, bucketOf } from './task-model.js';
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

const MEMBER = {
  realm: 'staff' as const,
  account: {
    id: 's2',
    givenName: 'Mikael',
    familyName: 'Aho',
    locale: 'en' as const,
    roles: ['clinician'],
  },
};

const yesterday = (() => {
  const at = new Date();
  at.setDate(at.getDate() - 1);
  return at.toISOString().slice(0, 10);
})();

const TASKS = [
  {
    id: 'k1',
    treatment_id: 't1',
    patient_id: 'p1',
    title: 'Call patient about lab results',
    detail: '',
    due_date: yesterday,
    status: 'open',
    assignee_id: 's2',
    treatment_name: 'Breast ca adjuvant FEC',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    assignee_given: 'Mikael',
    assignee_family: 'Aho',
  },
  {
    id: 'k2',
    treatment_id: 't1',
    patient_id: 'p1',
    title: 'Order infusion supplies',
    detail: '',
    due_date: null,
    status: 'open',
    assignee_id: null,
    treatment_name: 'Breast ca adjuvant FEC',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    assignee_given: null,
    assignee_family: null,
  },
];

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
      if (url === '/api/staff/tasks') return json(TASKS);
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('due-date buckets', () => {
  it('sorts around the local today', () => {
    expect(bucketOf(null, '2026-08-23')).toBe('later');
    expect(bucketOf('2026-08-22', '2026-08-23')).toBe('overdue');
    expect(bucketOf('2026-08-23', '2026-08-23')).toBe('today');
    expect(bucketOf('2026-08-30', '2026-08-23')).toBe('week');
    expect(bucketOf('2026-08-31', '2026-08-23')).toBe('later');
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('C5 tasks page', () => {
  it('tabs filter; groups label overdue; queue rows offer Claim', async () => {
    vi.mocked(api.whoami).mockResolvedValue(MEMBER);
    const { container } = render(appAt('/tasks'));
    await screen.findByRole('heading', { name: 'Tasks' });
    // default tab: MY tasks - only the assigned one
    await screen.findByText('Call patient about lab results');
    expect(screen.queryByText('Order infusion supplies')).toBeNull();
    expect(screen.getByText('Overdue')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: /Unclaimed/ }));
    await screen.findByText('Order infusion supplies');
    expect(screen.getByRole('button', { name: 'Claim' })).toBeTruthy();
    // a member cannot complete a task that is not theirs
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /Whole team/ }));
    await screen.findByText('Call patient about lab results');
    await screen.findByText('Order infusion supplies');

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('dashboard tasks slice', () => {
  it('clinician home shows my tasks and the queue count', async () => {
    vi.mocked(api.whoami).mockResolvedValue(MEMBER);
    const { container } = render(appAt('/'));
    await screen.findByRole('heading', { name: 'My tasks' });
    await screen.findByText('Call patient about lab results');
    await screen.findByText('1 unclaimed task in your teams');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
