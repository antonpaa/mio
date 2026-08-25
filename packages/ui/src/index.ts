/**
 * The Mio design system - warm editorial (docs/design/design-system.md).
 * Import '@mio/ui/theme.css' once per app for tokens, fonts and base styles.
 */

export { AppShell, CountBadge, type AppShellProps, type NavItem } from './components/app-shell.js';
export { Button, type ButtonProps, type ButtonVariant } from './components/button.js';
export { BodyMap, type BodyMapProps } from './components/body-map.js';
export { BodyMapView } from './components/body-map-view.js';
export { Card, CardHeader } from './components/card.js';
export { ConfirmDialog, type ConfirmDialogProps } from './components/confirm-dialog.js';
export { useModalFocus } from './components/use-modal-focus.js';
export { SeverityChip, StatusChip, type ChipTone, type Severity } from './components/chips.js';
export {
  IconAudit,
  IconBell,
  IconCalendar,
  IconDashboard,
  IconHome,
  IconMessages,
  IconPatients,
  IconReporting,
  IconRoles,
  IconSettings,
  IconSurveys,
  IconSymptoms,
  IconTasks,
  IconTeams,
  IconTreatments,
  IconUpdates,
  IconUsers,
  IconValues,
  type IconProps,
} from './components/icons.js';
export { LanguageSwitcher, type LanguageSwitcherProps } from './components/language-switcher.js';
export { Avatar, ListRow } from './components/list-row.js';
export { MioLockup, MioMark } from './components/logo.js';
export { EmptyState, ErrorState, Skeleton, Splash } from './components/states.js';
export { Switch } from './components/switch.js';
export { TextField, type TextFieldProps } from './components/text-field.js';
