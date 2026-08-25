import type { ReactElement, ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { ROLE_CAPABILITIES, type Role } from '@mio/authz';
import {
  AppShell,
  Avatar,
  Button,
  CountBadge,
  EmptyState,
  IconAudit,
  IconCalendar,
  IconDashboard,
  IconHome,
  IconMessages,
  IconPatients,
  IconReporting,
  IconRoles,
  IconSettings,
  IconSurveys,
  IconTasks,
  IconTeams,
  IconTreatments,
  IconUsers,
  type IconProps,
  type NavItem,
} from '@mio/ui';
import { AlertBell } from '../alerts/bell.js';
import { NotificationBell } from '../notifications/bell.js';
import { threadsQuery } from '../messages/model.js';
import { useSession } from '../session/session.js';

/**
 * The three shells, capability-gated: an item renders only when the role
 * holds a capability behind it. The server still decides per resource -
 * flags gate NAVIGATION, never access (ADR-0006).
 */

interface ShellItem {
  labelId: string;
  href: string;
  /** capability that makes this area meaningful for the role */
  capability?: string;
}

/** The print-registration glyph for each nav area (X10); decorative -
 * the localized label carries the name. */
const NAV_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  'nav.home': IconHome,
  'nav.dashboard': IconDashboard,
  'nav.patients': IconPatients,
  'nav.messages': IconMessages,
  'nav.treatments': IconTreatments,
  'nav.surveys': IconSurveys,
  'nav.calendar': IconCalendar,
  'nav.tasks': IconTasks,
  'nav.users': IconUsers,
  'nav.teams': IconTeams,
  'nav.roles': IconRoles,
  'nav.audit': IconAudit,
  'nav.reporting': IconReporting,
};

const PATIENT_ITEMS: ShellItem[] = [
  { labelId: 'nav.home', href: '/' },
  { labelId: 'nav.messages', href: '/messages', capability: 'message_thread.view' },
  { labelId: 'nav.treatments', href: '/treatments', capability: 'treatment.view' },
  { labelId: 'nav.surveys', href: '/surveys', capability: 'survey_response.submit' },
  { labelId: 'nav.calendar', href: '/calendar', capability: 'activity.view' },
];

const CLINICIAN_ITEMS: ShellItem[] = [
  { labelId: 'nav.dashboard', href: '/' },
  { labelId: 'nav.patients', href: '/patients', capability: 'patient_clinical_profile.view' },
  { labelId: 'nav.messages', href: '/messages', capability: 'message_thread.view' },
  { labelId: 'nav.surveys', href: '/surveys', capability: 'survey_template.view' },
  // the staff /treatments page is the TEMPLATE catalog, so the item
  // follows the capability of what it opens (authors hold it too)
  { labelId: 'nav.treatments', href: '/treatments', capability: 'treatment_template.view' },
  { labelId: 'nav.tasks', href: '/tasks', capability: 'task.view' },
  // A4 lives here, not in admin (P8 decided 2026-08-24): the metrics
  // are clinical aggregates, so the nav follows report.view
  { labelId: 'nav.reporting', href: '/reporting', capability: 'report.view' },
];

/** A standalone author's surface is the two catalogs. */
const AUTHOR_ITEMS: ShellItem[] = [
  { labelId: 'nav.surveys', href: '/', capability: 'survey_template.view' },
  { labelId: 'nav.treatments', href: '/treatments', capability: 'treatment_template.view' },
];

/** P2: the auditor's whole surface is the audit log. */
const AUDITOR_ITEMS: ShellItem[] = [{ labelId: 'nav.audit', href: '/' }];

const ADMIN_ITEMS: ShellItem[] = [
  { labelId: 'nav.users', href: '/', capability: 'staff_account.create' },
  { labelId: 'nav.teams', href: '/teams', capability: 'team.create' },
  { labelId: 'nav.roles', href: '/roles' },
  { labelId: 'nav.audit', href: '/audit', capability: 'audit_log.view_full' },
];

/** The admin areas as APPENDED entries for a dual-capacity account whose
 * home is the clinician shell - users cannot sit on '/' there. */
const ADMIN_APPENDED_ITEMS: ShellItem[] = [
  { labelId: 'nav.users', href: '/users', capability: 'staff_account.create' },
  { labelId: 'nav.teams', href: '/teams', capability: 'team.create' },
  { labelId: 'nav.roles', href: '/roles' },
  { labelId: 'nav.audit', href: '/audit', capability: 'audit_log.view_full' },
];

/** The roles a session holds: ['patient'], or the staff account's set. */
export function sessionRoles(session: {
  realm: 'patient' | 'staff' | null;
  account: { roles?: string[] } | null;
}): readonly Role[] {
  if (session.realm === 'patient') return ['patient'];
  return (session.account?.roles ?? []) as Role[];
}

/** Capability UNION across held roles - exactly the engine's semantics. */
export function capabilityUnion(roles: readonly Role[]): Set<string> {
  return new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role] ?? []));
}

/**
 * Shell composition for a role SET (2026-08-25 restructure). A clinician
 * keeps the clinical shell; holding administrator besides appends the
 * admin areas to it. Auditor is exclusive by rule; a standalone author
 * gets the catalogs; a pure administrator keeps the admin shell.
 */
function shellFor(roles: readonly Role[]): {
  variant: 'patient' | 'clinician' | 'admin';
  items: ShellItem[];
} {
  if (roles.includes('patient')) return { variant: 'patient', items: PATIENT_ITEMS };
  if (roles.includes('clinician')) {
    return {
      variant: 'clinician',
      items: roles.includes('administrator')
        ? [...CLINICIAN_ITEMS, ...ADMIN_APPENDED_ITEMS]
        : CLINICIAN_ITEMS,
    };
  }
  if (roles.includes('auditor')) return { variant: 'admin', items: AUDITOR_ITEMS };
  if (roles.includes('administrator')) return { variant: 'admin', items: ADMIN_ITEMS };
  return { variant: 'clinician', items: AUTHOR_ITEMS };
}

export function SignedInShell({ children }: { children: ReactNode }): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const roles = sessionRoles(session);
  const capabilities = capabilityUnion(roles);
  const { variant, items } = shellFor(roles);

  // the same audited disclosure the messages page makes - shared cache,
  // one query key per realm (the WP-19 bell precedent)
  const threads = useQuery({
    ...threadsQuery(session.realm === 'patient' ? 'patient' : 'staff'),
    enabled: capabilities.has('message_thread.view'),
  });
  const unread = (threads.data ?? []).reduce((sum, row) => sum + row.unread, 0);

  const navItems: NavItem[] = items
    .filter((item) => item.capability === undefined || capabilities.has(item.capability))
    .map((item) => {
      const Icon = NAV_ICONS[item.labelId];
      return {
        label: intl.formatMessage({ id: item.labelId }),
        href: item.href,
        active: pathname === item.href,
        ...(Icon !== undefined ? { icon: <Icon size={17} /> } : {}),
        ...(item.labelId === 'nav.messages' && unread > 0 ? { badge: unread } : {}),
      };
    });

  const initials = `${session.account?.givenName?.[0] ?? ''}${session.account?.familyName?.[0] ?? ''}`;

  return (
    <AppShell
      variant={variant}
      navLabel={intl.formatMessage({ id: 'nav.label' })}
      menuLabel={intl.formatMessage({ id: 'nav.menu' })}
      items={navItems}
      renderLink={(item, className) => (
        <Link to={item.href} className={className} aria-current={item.active ? 'page' : undefined}>
          {item.icon}
          {item.label}
          {item.badge !== undefined ? (
            <CountBadge
              count={item.badge}
              label={intl.formatMessage({ id: 'messages.unread' }, { count: item.badge })}
            />
          ) : null}
        </Link>
      )}
      end={
        <div className="flex items-center gap-3">
          {variant === 'clinician' && capabilities.has('alert.view') ? <AlertBell /> : null}
          {capabilities.has('notification.view') && variant !== 'admin' ? (
            <NotificationBell realm={variant === 'patient' ? 'patient' : 'staff'} />
          ) : null}
          {variant === 'patient' && capabilities.has('own_settings.update') ? (
            <Link
              to="/settings"
              aria-label={intl.formatMessage({ id: 'nav.settings' })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-pill text-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <IconSettings size={20} />
            </Link>
          ) : null}
          <Avatar
            initials={initials}
            label={`${session.account?.givenName ?? ''} ${session.account?.familyName ?? ''}`}
          />
          <Button
            variant="quiet"
            size="sm"
            onPress={() => {
              void session.signOut().then(() => navigate({ to: '/login' }));
            }}
          >
            <FormattedMessage id="nav.signOut" />
          </Button>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

/** The empty landing every area shows until its work package arrives. */
export function PlaceholderHome(): ReactElement {
  const intl = useIntl();
  return (
    <div className="mx-auto max-w-md pt-10">
      <EmptyState title={intl.formatMessage({ id: 'home.allCaughtUp' })}>
        <FormattedMessage id="home.nothing" />
      </EmptyState>
    </div>
  );
}
