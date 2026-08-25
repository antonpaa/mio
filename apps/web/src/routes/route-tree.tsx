import { createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl';
import type { Locale } from '@mio/i18n';
import { Splash } from '@mio/ui';
import { MESSAGES } from '../i18n/messages.js';
import { detectLocale, persistLocale } from '../lib/locale.js';
import { SessionProvider, SESSION_QUERY, useSession } from '../session/session.js';
import { AuthLayout } from '../auth/auth-layout.js';
import { SignInPage } from '../auth/sign-in.js';
import { VerifyPage } from '../auth/verify.js';
import { WelcomePage } from '../auth/welcome.js';
import { ForgotPage, ForgotSentPage, ResetPage } from '../auth/forgot.js';
import { capabilityUnion, PlaceholderHome, sessionRoles, SignedInShell } from '../app/shells.js';
import { LocaleContext, useLocaleControls, type LocaleControls } from '../app/locale-context.js';
import { RosterPage } from '../patients/roster.js';
import { PatientCalendarPage } from '../scheduling/calendar.js';
import { TasksPage } from '../tasks/tasks-page.js';
import { MyTasksCard } from '../tasks/my-tasks-card.js';
import { TriageCard } from '../alerts/triage-card.js';
import { AlertPage } from '../alerts/alert-page.js';
import { ResponseDetailPage } from '../surveys/response-detail.js';
import { MessagesPage } from '../messages/messages-page.js';
import { MessageThreadPage } from '../messages/thread-page.js';
import { NotificationsPage } from '../notifications/notifications-page.js';
import { SettingsPage } from '../notifications/settings-page.js';
import { greetingIdForHour, PatientHomePage } from '../home/patient-home.js';
import { AgendaCard, OverdueCard, UnreadConversationsCard } from '../dashboard/cards.js';
import { PatientSurveysPage } from '../surveys/patient-surveys.js';
import { SurveyFillPage } from '../surveys/fill.js';
import { SurveySubmittedPage } from '../surveys/submitted.js';
import { SurveyCatalogPage } from '../surveys/builder/catalog.js';
import { SurveyBuilderPage } from '../surveys/builder/builder-page.js';
import { PatientProfilePage } from '../patients/profile.js';
import { TreatmentCatalogPage } from '../treatments/catalog.js';
import { TreatmentDetailPage } from '../treatments/detail.js';
import { PatientTreatmentsPage } from '../treatments/patient-treatments.js';
import { AdminUsersPage } from '../admin/users-page.js';
import { AdminTeamsPage } from '../admin/teams-page.js';
import { AdminRolesPage } from '../admin/roles-page.js';
import { AdminAuditPage } from '../admin/audit-page.js';
import { ReportingPage } from '../reporting/reporting-page.js';
import { OnBehalfFillPage } from '../surveys/fill-on-behalf.js';

function Root(): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());
  const controls = useMemo<LocaleControls>(
    () => ({
      locale,
      setLocale: (next) => {
        persistLocale(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={controls}>
      <IntlProvider locale={locale} messages={MESSAGES[locale]} defaultLocale="en">
        <SessionProvider>
          <AccountLocaleSync />
          <Outlet />
        </SessionProvider>
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

/** After sign-in the account's stored locale wins (persistent choice). */
function AccountLocaleSync(): null {
  const session = useSession();
  const controls = useLocaleControls();
  useEffect(() => {
    if (session.account && session.account.locale !== controls.locale) {
      controls.setLocale(session.account.locale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on account change only
  }, [session.account]);
  return null;
}

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Root });

function AuthedIndex(): ReactElement {
  const session = useSession();
  // beforeLoad already guaranteed a session exists; the context value can
  // lag one microtask behind the cache, so render the splash - never a
  // redirect - while it catches up.
  if (session.loading || !session.account) return <Splash />;
  const roles = sessionRoles(session);
  return (
    <SignedInShell>
      {session.realm === 'patient' ? (
        // P1/P7 (WP-26): the patient landing widgets
        <PatientHomePage />
      ) : roles.includes('clinician') ? (
        // clinical capacity wins the landing (dual-capacity accounts
        // reach the admin areas from the appended nav entries)
        <ClinicianDashboard />
      ) : roles.includes('auditor') ? (
        // P2: the auditor's whole surface is the audit log
        <AdminAuditPage />
      ) : roles.includes('administrator') ? (
        // A1 (WP-28): the administrator lands on user management
        <AdminUsersPage />
      ) : (
        // a standalone author lands on the catalog they author (B1)
        <SurveyCatalogPage />
      )}
    </SignedInShell>
  );
}

/** C1 complete (WP-27): triage over tasks in the main column, the
 * worklists beside them, and the segmented filter narrowing the queue
 * to the caller's assignments. */
function ClinicianDashboard(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const now = new Date();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {/* C1's greeting header: serif time-of-day salute, the date and
          clock under it, the worklist filter on the right */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl italic text-ink">
            <FormattedMessage
              id={greetingIdForHour(now.getHours())}
              values={{ name: session.account?.givenName ?? '' }}
            />
          </h1>
          <p className="mt-1 text-sm text-secondary">
            {intl.formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' })},{' '}
            {intl.formatTime(now, { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex gap-1.5">
          {(['all', 'mine'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${
                filter === option
                  ? 'border-teal bg-teal-tint font-medium text-teal'
                  : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {intl.formatMessage({ id: `dashboard.filter.${option}` })}
            </button>
          ))}
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <TriageCard filter={filter} />
          <MyTasksCard />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <OverdueCard />
          <AgendaCard />
          <UnreadConversationsCard />
        </div>
      </div>
    </div>
  );
}

function AuthPage({ page }: { page: ReactElement }): ReactElement {
  const controls = useLocaleControls();
  return (
    <AuthLayout locale={controls.locale} onLocaleChange={controls.setLocale}>
      {page}
    </AuthLayout>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // The auth gate lives in the ROUTER, not in a component effect: it reads
  // the query cache directly, which is synchronous with establish()/logout,
  // while React context notifications are microtask-deferred.
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(SESSION_QUERY);
    if (!session) throw redirect({ to: '/login' });
  },
  component: AuthedIndex,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => <AuthPage page={<SignInPage />} />,
});
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/verify',
  component: () => <AuthPage page={<VerifyPage />} />,
  validateSearch: (search: Record<string, unknown>) => ({
    realm: search['realm'] === 'staff' ? ('staff' as const) : ('patient' as const),
    challenge: String(search['challenge'] ?? ''),
  }),
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/forgot',
  component: () => <AuthPage page={<ForgotPage />} />,
});
const forgotSentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/forgot/sent',
  component: () => <AuthPage page={<ForgotSentPage />} />,
});
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome/$token',
  component: () => <AuthPage page={<WelcomePage />} />,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset/$token',
  component: () => <AuthPage page={<ResetPage />} />,
});

function ShellPage({ page }: { page: ReactElement }): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return <SignedInShell>{page}</SignedInShell>;
}

const requireSession = async ({ context }: { context: RouterContext }): Promise<void> => {
  const session = await context.queryClient.ensureQueryData(SESSION_QUERY);
  if (!session) throw redirect({ to: '/login' });
};

const patientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<RosterPage />} />,
});
const patientProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<PatientProfilePage />} />,
});
/** On-behalf survey entry (PP "Report"): the patient's own fill screen,
 * driven by the clinician, under a banner saying exactly that. */
const onBehalfFillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/fill/$responseId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<OnBehalfFillPage />} />,
});
const treatmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/treatments',
  beforeLoad: requireSession,
  component: TreatmentsIndex,
});
const treatmentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/treatments/$treatmentId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<TreatmentDetailPage />} />,
});
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  beforeLoad: requireSession,
  component: CalendarIndex,
});
const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  beforeLoad: requireSession,
  component: TasksIndex,
});

/** /tasks is clinician-side (C5); patients have no tasks surface. */
function TasksIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return (
    <SignedInShell>{session.realm === 'staff' ? <TasksPage /> : <PlaceholderHome />}</SignedInShell>
  );
}

const surveysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/surveys',
  beforeLoad: requireSession,
  component: SurveysIndex,
});
const surveyFillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/surveys/fill/$responseId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<SurveyFillPage />} />,
});
const surveySubmittedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/surveys/done/$responseId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<SurveySubmittedPage />} />,
});

/** /surveys: the patient's fill list (P3) or the staff catalog (B1). */
function SurveysIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return (
    <SignedInShell>
      {session.realm === 'patient' ? <PatientSurveysPage /> : <SurveyCatalogPage />}
    </SignedInShell>
  );
}

const surveyBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/surveys/builder/$versionId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<SurveyBuilderPage />} />,
});

const alertRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/alerts/$alertId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<AlertPage />} />,
});

const responseDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/responses/$responseId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<ResponseDetailPage />} />,
});

const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/messages',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<MessagesPage />} />,
});

const messageThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/messages/$treatmentId',
  beforeLoad: requireSession,
  component: () => <ShellPage page={<MessageThreadPage />} />,
});

/** Both realms have a centre now: the patient's own (P11) and the staff
 * one, where a B7 rule's team-addressed notification lands. The admin
 * plane has neither - it holds no notification capability. */
function NotificationsIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  const may = capabilityUnion(sessionRoles(session)).has('notification.view');
  return (
    <SignedInShell>
      {!may ? (
        <PlaceholderHome />
      ) : session.realm === 'patient' ? (
        <NotificationsPage />
      ) : (
        <NotificationsPage realm="staff" />
      )}
    </SignedInShell>
  );
}

function SettingsIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return (
    <SignedInShell>
      {session.realm === 'patient' ? <SettingsPage /> : <PlaceholderHome />}
    </SignedInShell>
  );
}

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  beforeLoad: requireSession,
  component: NotificationsIndex,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: requireSession,
  component: SettingsIndex,
});

/** The admin areas (WP-28) exist only for the administrator role; any
 * other signed-in visitor gets the shared placeholder, and the server
 * still refuses the data (matrix, not navigation, decides access). */
function AdminIndex({ page }: { page: ReactElement }): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  const isAdmin = session.realm === 'staff' && sessionRoles(session).includes('administrator');
  return <SignedInShell>{isAdmin ? page : <PlaceholderHome />}</SignedInShell>;
}

/** A1 for dual-capacity accounts, whose '/' is the clinician dashboard. */
const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  beforeLoad: requireSession,
  component: () => <AdminIndex page={<AdminUsersPage />} />,
});
const adminTeamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/teams',
  beforeLoad: requireSession,
  component: () => <AdminIndex page={<AdminTeamsPage />} />,
});
const adminRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roles',
  beforeLoad: requireSession,
  component: () => <AdminIndex page={<AdminRolesPage />} />,
});
/** /audit belongs to whoever the matrix grants view_full - today the
 * auditor alone; the nav item and this gate both read the capability. */
function AuditIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  const may = capabilityUnion(sessionRoles(session)).has('audit_log.view_full');
  return <SignedInShell>{may ? <AdminAuditPage /> : <PlaceholderHome />}</SignedInShell>;
}

const adminAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  beforeLoad: requireSession,
  component: AuditIndex,
});
/** A4 reporting sits with whoever the matrix grants report.view -
 * clinicians, not administrators (gate P8, decided 2026-08-24). */
function ReportingIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  const may = capabilityUnion(sessionRoles(session)).has('report.view');
  return <SignedInShell>{may ? <ReportingPage /> : <PlaceholderHome />}</SignedInShell>;
}

const reportingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reporting',
  beforeLoad: requireSession,
  component: ReportingIndex,
});

/** /calendar is the patient's consolidated view (P9); staff have no page
 * here yet - their day lives on the dashboard (C1, WP-13+). */
function CalendarIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return (
    <SignedInShell>
      {session.realm === 'patient' ? <PatientCalendarPage /> : <PlaceholderHome />}
    </SignedInShell>
  );
}

/** /treatments serves both realms: catalog for staff, own list for patients. */
function TreatmentsIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return (
    <SignedInShell>
      {session.realm === 'patient' ? <PatientTreatmentsPage /> : <TreatmentCatalogPage />}
    </SignedInShell>
  );
}

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  verifyRoute,
  forgotRoute,
  forgotSentRoute,
  welcomeRoute,
  resetRoute,
  patientsRoute,
  patientProfileRoute,
  onBehalfFillRoute,
  treatmentsRoute,
  treatmentDetailRoute,
  calendarRoute,
  tasksRoute,
  surveysRoute,
  surveyFillRoute,
  surveySubmittedRoute,
  surveyBuilderRoute,
  alertRoute,
  responseDetailRoute,
  messagesRoute,
  messageThreadRoute,
  notificationsRoute,
  settingsRoute,
  adminUsersRoute,
  adminTeamsRoute,
  adminRolesRoute,
  adminAuditRoute,
  reportingRoute,
]);
