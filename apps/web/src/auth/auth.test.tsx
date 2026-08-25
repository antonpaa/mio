import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { routeTree } from '../routes/route-tree.js';
import * as api from '../lib/api.js';
import axe from 'axe-core';

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

async function expectAxeClean(container: Element): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

beforeEach(() => {
  vi.mocked(api.whoami).mockResolvedValue(null);
  localStorage.clear();
});

describe('L1 sign in', () => {
  it('renders, is axe-clean, and routes to verify on success', async () => {
    vi.mocked(api.login).mockResolvedValue({
      status: 'otp_sent',
      realm: 'patient',
      challengeId: 'chal-1',
    });
    const { element } = appAt('/login');
    const { container } = render(element);

    await screen.findByRole('heading', { name: 'Welcome' });
    await expectAxeClean(container);

    await userEvent.type(screen.getByLabelText('Email'), 'anna@patient.example');
    await userEvent.type(screen.getByLabelText('Password'), 'calm-harbour-morning-42');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: "Verify it's you" });
    expect(api.login).toHaveBeenCalledWith('anna@patient.example', 'calm-harbour-morning-42');
  });

  it('shows the inline invalid state (L7)', async () => {
    vi.mocked(api.login).mockResolvedValue({ status: 'invalid' });
    const { element } = appAt('/login');
    render(element);
    await userEvent.type(await screen.findByLabelText('Email'), 'x@y.example');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('alert');
  });

  it('language switcher swaps every visible string and persists', async () => {
    const { element } = appAt('/login');
    render(element);
    await screen.findByRole('heading', { name: 'Welcome' });
    await userEvent.click(screen.getByRole('button', { name: 'fi' }));
    await screen.findByRole('heading', { name: 'Tervetuloa' });
    expect(localStorage.getItem('mio.locale')).toBe('fi');
  });
});

describe('L2 verify', () => {
  it('verifies and lands in the signed-in shell', async () => {
    vi.mocked(api.verifyOtp).mockResolvedValue({
      status: 'signed_in',
      account: { id: 'a1', givenName: 'Anna', familyName: 'Virtanen', locale: 'en' },
    });
    vi.mocked(api.whoami)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        realm: 'patient',
        account: { id: 'a1', givenName: 'Anna', familyName: 'Virtanen', locale: 'en' },
      });
    const { element } = appAt('/login/verify?realm=patient&challenge=chal-1');
    render(element);
    await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // the patient lands on the P1/P7 home (WP-26)
    await screen.findByText('Hello, Anna');
    expect(api.verifyOtp).toHaveBeenCalledWith('patient', 'chal-1', '123456');
  });
});

describe('L3 welcome', () => {
  it('greets by name, requires terms, submits', async () => {
    vi.mocked(api.inspectInvite).mockImplementation(async (realm) =>
      realm === 'patient'
        ? { status: 'ok', givenName: 'Anna', email: 'anna@patient.example' }
        : { status: 'invalid' },
    );
    vi.mocked(api.acceptInvite).mockResolvedValue({ status: 'otp_sent', challengeId: 'chal-2' });
    const { element } = appAt('/welcome/tok-123');
    const { container } = render(element);

    await screen.findByRole('heading', { name: 'Hello, Anna' });
    await expectAxeClean(container);

    const submit = screen.getByRole('button', { name: 'Create my account' });
    expect(submit).toHaveProperty('disabled');
    await userEvent.type(screen.getByLabelText('Create password'), 'quiet-meadow-evening-77');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(submit);
    await screen.findByRole('heading', { name: "Verify it's you" });
    expect(api.acceptInvite).toHaveBeenCalledWith('patient', 'tok-123', 'quiet-meadow-evening-77');
  });
});

describe('L5/L6 forgot', () => {
  it('always lands on the calm confirmation', async () => {
    const { element } = appAt('/login/forgot');
    const { container } = render(element);
    await userEvent.type(await screen.findByLabelText('Email'), 'whoever@example.example');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByRole('heading', { name: 'Check your email' });
    await expectAxeClean(container);
    expect(api.requestReset).toHaveBeenCalled();
  });
});

describe('signed-in shells', () => {
  it('clinician role gets the capability-gated clinician nav', async () => {
    vi.mocked(api.whoami).mockResolvedValue({
      realm: 'staff',
      account: {
        id: 's1',
        givenName: 'Elina',
        familyName: 'Koskinen',
        locale: 'en',
        role: 'treatment_lead',
      },
    });
    const { element } = appAt('/');
    render(element);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await screen.findByRole('link', { name: 'Patients' });
    await screen.findByRole('link', { name: 'Tasks' });
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('administrator gets the admin shell and NO clinical navigation', async () => {
    vi.mocked(api.whoami).mockResolvedValue({
      realm: 'staff',
      account: {
        id: 's2',
        givenName: 'Hanna',
        familyName: 'Korpela',
        locale: 'en',
        role: 'administrator',
      },
    });
    const { element } = appAt('/');
    render(element);
    await screen.findByText('Administration');
    await screen.findByRole('link', { name: 'Users' });
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Patients' })).toBeNull();
    });
  });

  it('patient shell in Finnish uses the account locale', async () => {
    vi.mocked(api.whoami).mockResolvedValue({
      realm: 'patient',
      account: { id: 'p1', givenName: 'Anna', familyName: 'Virtanen', locale: 'fi' },
    });
    const { element } = appAt('/');
    render(element);
    await screen.findByRole('link', { name: 'Viestit' });
    await screen.findByText('Hei, Anna');
  });
});
