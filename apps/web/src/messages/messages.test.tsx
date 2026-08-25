import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import { docFromText } from '@mio/contracts';
import { routeTree } from '../routes/route-tree.js';
import { Composer, domToDoc } from './composer.js';
import { IntlProvider } from 'react-intl';
import { MESSAGES } from '../i18n/messages.js';
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
const PATIENT = {
  realm: 'patient' as const,
  account: { id: 'p1', givenName: 'Anna', familyName: 'Virtanen', locale: 'en' as const },
};

const STAFF_THREADS = [
  {
    treatment_id: 't1',
    treatment_name: 'Chemo cycle 2',
    state: 'active',
    patient_id: 'p1',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
    unread: 2,
    last_preview: 'The nausea got worse over the weekend.',
    last_at: '2026-08-20T09:14:00Z',
    last_author_realm: 'patient',
  },
];

const STAFF_THREAD_DETAIL = {
  treatment: {
    id: 't1',
    name: 'Chemo cycle 2',
    state: 'active',
    patient_id: 'p1',
    patient_given: 'Anna',
    patient_family: 'Virtanen',
  },
  readOnly: false,
  items: [
    {
      kind: 'message',
      id: 'm1',
      author_id: 'p1',
      author_realm: 'patient',
      author_given: 'Anna',
      author_family: 'Virtanen',
      body: docFromText('The nausea got worse over the weekend.'),
      created_at: '2026-08-20T09:14:00Z',
    },
    {
      kind: 'note',
      id: 'n1',
      author_id: 's1',
      author_realm: 'staff',
      author_given: 'Elina',
      author_family: 'Koskinen',
      body: docFromText('Check the antiemetic dosing before the next visit.'),
      created_at: '2026-08-20T11:00:00Z',
    },
  ],
  alerts: [{ id: 'al1', severity: 'high', status: 'new', created_at: '2026-08-20T10:00:00Z' }],
};

const PATIENT_ENDED_DETAIL = {
  treatment: { id: 't1', name: 'Chemo cycle 2', state: 'completed' },
  readOnly: true,
  items: [
    {
      kind: 'message',
      id: 'm1',
      author_id: 's1',
      author_realm: 'staff',
      author_given: 'Elina',
      author_family: 'Koskinen',
      body: docFromText('Thank you - the programme is now complete.'),
      created_at: '2026-08-20T09:14:00Z',
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

function stubFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [path, payload] of Object.entries(routes)) {
        if (url === path) {
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

beforeEach(() => {
  vi.mocked(api.whoami).mockResolvedValue(CLINICIAN);
});

describe('C4 team inbox', () => {
  it('lists conversations with unread counts and previews', async () => {
    stubFetch({ '/api/staff/messages': STAFF_THREADS, '/api/staff/alerts': [] });
    const { container } = render(appAt('/messages'));
    await screen.findByText('Anna Virtanen — Chemo cycle 2');
    expect(screen.getByText('The nausea got worse over the weekend.')).toBeTruthy();
    // the badge appears in the list row AND on the nav item - same query
    expect(screen.getAllByLabelText('2 unread').length).toBeGreaterThanOrEqual(2);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('the thread shows the labelled internal note, the alert marker and the note lane', async () => {
    stubFetch({
      '/api/staff/messages': STAFF_THREADS,
      '/api/staff/messages/threads/t1': STAFF_THREAD_DETAIL,
      '/api/staff/alerts': [],
    });
    const { container } = render(appAt('/messages/t1'));
    await screen.findByText('The nausea got worse over the weekend.');
    // the note is visibly distinct AND programmatically labelled
    expect(screen.getByText('Internal note — not visible to the patient')).toBeTruthy();
    expect(screen.getByText('Check the antiemetic dosing before the next visit.')).toBeTruthy();
    // the alert cross-reference marker
    expect(screen.getByText('Alert raised')).toBeTruthy();
    // Reply vs Internal note composer toggle (C4)
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Internal note' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('P14 ended programme', () => {
  it('keeps messages readable with no composer', async () => {
    vi.mocked(api.whoami).mockResolvedValue(PATIENT);
    stubFetch({
      '/api/patient/messages': [],
      '/api/patient/messages/threads/t1': PATIENT_ENDED_DETAIL,
    });
    render(appAt('/messages/t1'));
    await screen.findByText('Thank you - the programme is now complete.');
    expect(screen.getByText('Programme ended — messages kept for reading.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the composer DOM walk', () => {
  it('turns editable markup into the schema and nothing else', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div>Hello <b>world</b></div><ul><li>first</li><li><i>second</i></li></ul><div data-evil="x" onclick="steal()">tail</div>';
    const doc = domToDoc(root)!;
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: ['bold'] },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'second', marks: ['italic'] }],
                },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
      ],
    });
    expect(JSON.stringify(doc)).not.toContain('onclick');
  });
});

function IntlWrap({ children }: { children: ReactElement }): ReactElement {
  return (
    <IntlProvider locale="en" messages={MESSAGES.en} defaultLocale="en">
      {children}
    </IntlProvider>
  );
}

describe('X3 composer persistence', () => {
  it('keeps unsent text per draft key across unmount and clears on send', async () => {
    localStorage.clear();
    const first = render(
      <IntlWrap>
        <Composer
          label="Write"
          sendLabel="Send"
          busy={false}
          draftKey="acc1:t1:message"
          onSend={async () => {}}
        />
      </IntlWrap>,
    );
    const box = first.getByRole('textbox');
    box.innerHTML = '<div>Halfway through a thought</div>';
    fireEvent.input(box);
    first.unmount();

    // a fresh mount with the same key restores the text
    const second = render(
      <IntlWrap>
        <Composer
          label="Write"
          sendLabel="Send"
          busy={false}
          draftKey="acc1:t1:message"
          onSend={async () => {}}
        />
      </IntlWrap>,
    );
    expect(second.getByRole('textbox').textContent).toContain('Halfway through a thought');

    // sending clears the stored draft
    fireEvent.click(second.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(localStorage.getItem('mio.draft.acc1:t1:message')).toBeNull();
    });
    second.unmount();
    const third = render(
      <IntlWrap>
        <Composer
          label="Write"
          sendLabel="Send"
          busy={false}
          draftKey="acc1:t1:message"
          onSend={async () => {}}
        />
      </IntlWrap>,
    );
    expect(third.getByRole('textbox').textContent).toBe('');
  });
});

describe('WP-24 composer attachments', () => {
  it('uploads, shows scanning, flips to clean, and sends the attachment node', async () => {
    const sent: unknown[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/patient/attachments' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ attachmentId: '11111111-2222-4333-8444-555555555555' }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.startsWith('/api/patient/attachments/')) {
          polls += 1;
          // first poll still scanning, then clean bytes
          return polls === 1
            ? new Response('{"state":"quarantined"}', { status: 202 })
            : new Response(new Uint8Array([1]).buffer, { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    vi.useFakeTimers();
    try {
      const view = render(
        <IntlWrap>
          <Composer
            label="Write"
            sendLabel="Send"
            busy={false}
            attachmentConfig={{
              uploadUrl: '/api/patient/attachments',
              fetchBase: '/api/patient/attachments',
              treatmentId: 't1',
            }}
            onSend={async (doc) => {
              sent.push(doc);
            }}
          />
        </IntlWrap>,
      );
      const input = view.container.querySelector('input[type="file"]')!;
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'wound.png', {
        type: 'image/png',
      });
      await vi.waitFor(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        await vi.advanceTimersByTimeAsync(50);
        expect(view.getByText('wound.png')).toBeTruthy();
      });
      // scanning chip first
      expect(view.getByText('Checking…')).toBeTruthy();
      // two poll ticks: still scanning, then clean
      await vi.advanceTimersByTimeAsync(1600);
      await vi.advanceTimersByTimeAsync(1600);
      await vi.waitFor(() => {
        expect(view.getByText('✓')).toBeTruthy();
      });
      fireEvent.click(view.getByRole('button', { name: 'Send' }));
      await vi.waitFor(() => {
        expect(sent).toHaveLength(1);
      });
      const doc = sent[0] as { content: { type: string; attachmentId?: string }[] };
      expect(
        doc.content.some(
          (block) =>
            block.type === 'attachment' &&
            block.attachmentId === '11111111-2222-4333-8444-555555555555',
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
