import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement, ReactNode } from 'react';
import './styles.css';
import {
  AppShell,
  Avatar,
  Button,
  Card,
  CardHeader,
  CountBadge,
  EmptyState,
  ErrorState,
  IconAudit,
  IconBell,
  IconCalendar,
  IconDashboard,
  IconHome,
  IconMessages,
  IconPatients,
  IconReporting,
  IconRoles,
  IconSurveys,
  IconSymptoms,
  IconTasks,
  IconTeams,
  IconTreatments,
  IconUsers,
  IconValues,
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

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl italic text-ink">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

function Gallery(): ReactElement {
  const [locale, setLocale] = useState('en');
  const [showSplash, setShowSplash] = useState(false);

  if (showSplash) {
    return (
      <div onClick={() => setShowSplash(false)}>
        <Splash />
      </div>
    );
  }

  return (
    <AppShell
      variant="clinician"
      navLabel="Main navigation"
      menuLabel="Menu"
      items={[
        { label: 'Dashboard', href: '#', active: true },
        { label: 'Patients', href: '#' },
        { label: 'Messages', href: '#', badge: 7 },
        { label: 'Tasks', href: '#' },
      ]}
      renderLink={(item, className) => (
        <a href={item.href} className={className}>
          {item.label}
          {item.badge !== undefined ? (
            <CountBadge count={item.badge} label={`${item.badge} unread`} />
          ) : null}
        </a>
      )}
      end={<Avatar initials="EK" label="Elina Koskinen" />}
    >
      <div className="flex flex-col gap-8">
        <Section title="Brand">
          <MioLockup markSize={44} />
          <MioMark size={32} />
          <MioMark size={24} />
          <Button variant="quiet" onPress={() => setShowSplash(true)}>
            Show splash
          </Button>
        </Section>

        <Section title="Icons — print registration (hover to register)">
          <div className="flex flex-wrap gap-3">
            {(
              [
                ['Home', IconHome],
                ['Dashboard', IconDashboard],
                ['Patients', IconPatients],
                ['Messages', IconMessages],
                ['Surveys', IconSurveys],
                ['Treatments', IconTreatments],
                ['Tasks', IconTasks],
                ['Calendar', IconCalendar],
                ['Values', IconValues],
                ['Symptoms', IconSymptoms],
                ['Bell', IconBell],
                ['Users', IconUsers],
                ['Teams', IconTeams],
                ['Roles', IconRoles],
                ['Audit', IconAudit],
                ['Reporting', IconReporting],
              ] as const
            ).map(([name, Icon]) => (
              <button
                key={name}
                type="button"
                className="flex flex-col items-center gap-1 rounded-inner border border-border bg-surface px-3 py-2 text-xs text-secondary"
              >
                <Icon size={22} />
                {name}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <Button>Start</Button>
          <Button variant="quiet">Show</Button>
          <Button variant="danger">Discontinue</Button>
          <Button isDisabled>Start</Button>
          <Button size="sm">Acknowledge</Button>
        </Section>

        <Section title="Chips">
          <SeverityChip severity="high" />
          <SeverityChip severity="moderate" />
          <SeverityChip severity="low" />
          <StatusChip tone="teal">Active</StatusChip>
          <StatusChip>Draft</StatusChip>
          <StatusChip tone="amber">3 days overdue</StatusChip>
          <StatusChip tone="red">Discontinued</StatusChip>
        </Section>

        <Section title="Form">
          <div className="w-72">
            <TextField
              label="Email"
              placeholder="anna.virtanen@email.fi"
              description="We only use this to sign you in."
            />
          </div>
          <LanguageSwitcher
            locales={['en', 'fi', 'sv']}
            current={locale}
            onChange={setLocale}
            label="Language"
          />
        </Section>

        <Section title="Cards and rows">
          <Card className="w-96">
            <CardHeader title="Unread messages" action={<a href="#">Open inbox</a>} />
            <ListRow leading={<Avatar initials="AV" label="Anna Virtanen" />} trailing="14:02">
              <p className="truncate text-sm text-ink">
                I've had more nausea than usual after this cycle…
              </p>
            </ListRow>
            <ListRow leading={<Avatar initials="TH" label="Timo Heikkinen" />} trailing="11:37">
              <p className="truncate text-sm text-ink">Can I move next week's appointment?</p>
            </ListRow>
          </Card>
        </Section>

        <Section title="States">
          <div className="w-80">
            <EmptyState title="All caught up">
              Nothing needs your attention. Your next appointment is Monday 24 August at 10:30.
            </EmptyState>
          </div>
          <div className="w-80">
            <ErrorState onRetry={() => {}} />
          </div>
          <div className="flex w-60 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
