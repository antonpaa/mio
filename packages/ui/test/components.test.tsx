import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AppShell,
  Avatar,
  BodyMap,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  CountBadge,
  EmptyState,
  ErrorState,
  LanguageSwitcher,
  ListRow,
  MioLockup,
  MioMark,
  SeverityChip,
  Skeleton,
  Splash,
  StatusChip,
  TextField,
} from '../src/index.js';
import { axeViolations } from './axe.js';

describe('kit renders and is axe-clean', () => {
  it('buttons, chips, fields', async () => {
    const { container } = render(
      <main>
        <Button>Start</Button>
        <Button variant="quiet">Show</Button>
        <Button variant="danger">Discontinue</Button>
        <SeverityChip severity="high" />
        <SeverityChip severity="moderate" />
        <SeverityChip severity="low" />
        <StatusChip tone="teal">Active</StatusChip>
        <StatusChip>Draft</StatusChip>
        <TextField label="Email" description="We never share this" placeholder="anna@example.fi" />
      </main>,
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeDefined();
    expect(screen.getByText('High')).toBeDefined();
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('cards, rows, avatars', async () => {
    const { container } = render(
      <main>
        <Card>
          <CardHeader title="Alerts" action={<a href="/alerts">All alerts</a>} />
          <ListRow leading={<Avatar initials="AV" label="Anna Virtanen" />} trailing="14:02">
            Anna Virtanen
          </ListRow>
          <ListRow leading={<Avatar initials="MA" />}>Mikael Aho</ListRow>
        </Card>
      </main>,
    );
    expect(screen.getByRole('heading', { name: 'Alerts' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Anna Virtanen' })).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('empty, error, loading states', async () => {
    let retried = false;
    const { container } = render(
      <main>
        <EmptyState title="All caught up">Nothing needs your attention.</EmptyState>
        <ErrorState onRetry={() => (retried = true)} />
        <Skeleton className="h-4 w-40" />
      </main>,
    );
    expect(screen.getByText('All caught up')).toBeDefined();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(retried).toBe(true);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('splash and logo', async () => {
    const { container } = render(
      <div>
        <Splash />
        <MioLockup />
        <MioMark size={24} />
      </div>,
    );
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByRole('img', { name: 'Mio' })).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('language switcher exposes pressed state', async () => {
    const changes: string[] = [];
    const { container } = render(
      <LanguageSwitcher
        locales={['en', 'fi', 'sv']}
        current="fi"
        onChange={(l) => changes.push(l)}
        label="Language"
      />,
    );
    const fi = screen.getByRole('button', { name: 'fi', pressed: true });
    expect(fi).toBeDefined();
    screen.getByRole('button', { name: 'sv' }).click();
    expect(changes).toEqual(['sv']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('app shell: centered nav with badges, admin masthead', async () => {
    const { container } = render(
      <AppShell
        variant="admin"
        navLabel="Main navigation"
        menuLabel="Menu"
        items={[
          { label: 'Users', href: '/admin/users', active: true },
          { label: 'Audit log', href: '/admin/audit', badge: 2 },
        ]}
        renderLink={(item, className) => (
          <a href={item.href} className={className} aria-current={item.active ? 'page' : undefined}>
            {item.label}
            {item.badge !== undefined ? (
              <CountBadge count={item.badge} label={`${item.badge} unread`} />
            ) : null}
          </a>
        )}
        end={<Avatar initials="HK" label="Hanna Korpela" />}
      >
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeDefined();
    expect(screen.getByText('Administration')).toBeDefined();
    expect(screen.getByRole('link', { name: /Users/ })).toBeDefined();
    // the mobile menu panel stays out of the accessibility tree until opened
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('link', { name: /Users/ })).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('body map: parallel checkbox group carries the same state', async () => {
    const toggles: string[] = [];
    const { container } = render(
      <main>
        <BodyMap
          selected={['chest', 'forearm-left']}
          onToggle={(id) => toggles.push(id)}
          labels={{ chest: 'Chest', 'forearm-left': 'Left forearm', head: 'Head' }}
          viewLabels={{ front: 'Front', back: 'Back' }}
          legendLabel="Body areas"
          summary="2 areas selected — chest, left forearm"
        />
      </main>,
    );
    expect(screen.getByText('2 areas selected — chest, left forearm')).toBeDefined();
    const chest = screen.getByRole('checkbox', { name: 'Chest' }) as HTMLInputElement;
    expect(chest.checked).toBe(true);
    const head = screen.getByRole('checkbox', { name: 'Head' }) as HTMLInputElement;
    expect(head.checked).toBe(false);
    fireEvent.click(head);
    expect(toggles).toEqual(['head']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('confirm dialog: alertdialog with safe default focus', async () => {
    const { container } = render(
      <ConfirmDialog
        title="Discontinue this treatment?"
        cancelLabel="Go back"
        confirmLabel="Discontinue"
        danger
        onCancel={() => {}}
        onConfirm={() => {}}
      >
        <p>This cannot be undone.</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Discontinue this treatment?' })).toBeDefined();
    expect(document.activeElement?.textContent).toBe('Go back');
    expect(await axeViolations(container)).toEqual([]);
  });
});
