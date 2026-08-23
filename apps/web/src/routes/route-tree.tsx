import { createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { IntlProvider } from 'react-intl';
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
import { PlaceholderHome, SignedInShell } from '../app/shells.js';
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
import { PatientHomePage } from '../home/patient-home.js';
import { PatientSurveysPage } from '../surveys/patient-surveys.js';
import { SurveyFillPage } from '../surveys/fill.js';
import { SurveySubmittedPage } from '../surveys/submitted.js';
import { SurveyCatalogPage } from '../surveys/builder/catalog.js';
import { SurveyBuilderPage } from '../surveys/builder/builder-page.js';
import { PatientProfilePage } from '../patients/profile.js';
import { TreatmentCatalogPage } from '../treatments/catalog.js';
import { TreatmentDetailPage } from '../treatments/detail.js';
import { PatientTreatmentsPage } from '../treatments/patient-treatments.js';

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
  const clinician = session.realm === 'staff' && session.account.role !== 'administrator';
  return (
    <SignedInShell>
      {clinician ? (
        // C1 slices so far: the triage queue (WP-19) over the tasks card
        // (WP-13); the full dashboard lands with WP-27.
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <TriageCard />
          <MyTasksCard />
        </div>
      ) : session.realm === 'patient' ? (
        // P1/P7 (WP-26): the patient landing widgets
        <PatientHomePage />
      ) : (
        <PlaceholderHome />
      )}
    </SignedInShell>
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

/** P11 and the P8 slice are patient surfaces; staff land on the shared
 * placeholder until WP-27 gives them a centre of their own. */
function NotificationsIndex(): ReactElement {
  const session = useSession();
  if (session.loading || !session.account) return <Splash />;
  return (
    <SignedInShell>
      {session.realm === 'patient' ? <NotificationsPage /> : <PlaceholderHome />}
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
]);
