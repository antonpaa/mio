import type { ReactElement, ReactNode } from 'react';

/**
 * Print-registration icons (design delta X10, docs/design/README.md).
 * Warm editorial is a print language, and the mark itself is two
 * misregistered tinted circles - so every icon carries the logo's light
 * circle behind a crisp ink stroke. At rest the tint sits low-left of
 * the ink, exactly like the light circle in the lockup; when the
 * enclosing link or button is hovered or focused - and on the current
 * nav page - it slides into register (theme.css owns the motion, so
 * `prefers-reduced-motion` is honoured by the global rule).
 *
 * Hand-drawn on a 24-grid, stroke 1.6, round caps. Icons are decorative
 * by contract: always `aria-hidden`, the text label beside them carries
 * the name. No icon library dependency - each glyph is a few lines of
 * SVG we own (ADR-0009).
 */

function IconBase({
  size = 20,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`mio-icon shrink-0 ${className ?? ''}`.trim()}
    >
      {/* the logo's light circle runs 14% at lockup size; small glyphs
          need a touch more ink for the layer to read */}
      <circle
        className="mio-icon-tint"
        cx="12.6"
        cy="11.4"
        r="8"
        fill="var(--color-teal, #115E59)"
        opacity="0.18"
      />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  );
}

export interface IconProps {
  size?: number;
  className?: string;
}

export function IconHome(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4.75 10.4 12 4.75l7.25 5.65V18.5a1.25 1.25 0 0 1-1.25 1.25h-4V15a2 2 0 0 0-4 0v4.75H6A1.25 1.25 0 0 1 4.75 18.5Z" />
    </IconBase>
  );
}

export function IconDashboard(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="4.5" y="4.5" width="6.5" height="8" rx="1.5" />
      <rect x="13.75" y="4.5" width="5.75" height="4.75" rx="1.5" />
      <rect x="13.75" y="12" width="5.75" height="7.5" rx="1.5" />
      <rect x="4.5" y="15.25" width="6.5" height="4.25" rx="1.5" />
    </IconBase>
  );
}

export function IconPatients(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="9.2" cy="8.6" r="3.1" />
      <path d="M3.8 19.25c.35-3.1 2.5-5 5.4-5s5.05 1.9 5.4 5" />
      <path d="M15.2 5.9a3.1 3.1 0 0 1 0 5.4" />
      <path d="M16.6 14.55c2.15.55 3.5 2.2 3.75 4.7" />
    </IconBase>
  );
}

export function IconMessages(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h11a1.75 1.75 0 0 1 1.75 1.75v7a1.75 1.75 0 0 1-1.75 1.75h-6.9l-3.85 3v-3H6.5a1.75 1.75 0 0 1-1.75-1.75Z" />
    </IconBase>
  );
}

export function IconSurveys(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="5.5" y="5.25" width="13" height="14.25" rx="1.75" />
      <path d="M9.25 5.25V4.5h5.5v.75" />
      <path d="M8.75 10.75h6.5M8.75 14.25h4.5" />
    </IconBase>
  );
}

export function IconTreatments(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m12 4.5 7 3.5-7 3.5-7-3.5Z" />
      <path d="m5 12.25 7 3.5 7-3.5" />
      <path d="m5 16.25 7 3.5 7-3.5" />
    </IconBase>
  );
}

export function IconTasks(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="m8.75 12.25 2.25 2.25 4.5-4.75" />
    </IconBase>
  );
}

export function IconCalendar(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="4.75" y="6" width="14.5" height="13" rx="1.75" />
      <path d="M4.75 10h14.5M8.5 4.25V7M15.5 4.25V7" />
      <path d="M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 16.5h.01M12 16.5h.01" />
    </IconBase>
  );
}

export function IconValues(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4.75 4.75v13a1.5 1.5 0 0 0 1.5 1.5h13" />
      <path d="m8.25 14.25 3.1-3.7 2.6 2.1 4.3-5.4" />
      <circle cx="18.25" cy="7.25" r="1.1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconSymptoms(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M3.75 12.5h3.4l2-4.9 3 8.8 2.3-6 1.3 2.1h4.5" />
    </IconBase>
  );
}

export function IconBell(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M14.86 17.08a24 24 0 0 0 5.45-1.3 8.97 8.97 0 0 1-2.31-6.02V9a6 6 0 1 0-12 0v.75a8.97 8.97 0 0 1-2.31 6.02 24 24 0 0 0 5.45 1.3m5.72 0a24.3 24.3 0 0 1-5.72 0m5.72 0a3 3 0 1 1-5.72 0" />
    </IconBase>
  );
}

/**
 * Updates - the notification centre. Deliberately NOT the bell: on the
 * clinician shell it sits beside IconBell, which carries alerts, and
 * two identical bells side by side would say the two are the same
 * urgency. An open envelope reads as "something to read", the bell as
 * "something is wrong".
 */
export function IconUpdates(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M3.6 10.2 12 4.75l8.4 5.45v7.05a1.55 1.55 0 0 1-1.55 1.55H5.15a1.55 1.55 0 0 1-1.55-1.55z" />
      <path d="m3.6 10.2 7.5 4.6c.55.34 1.25.34 1.8 0l7.5-4.6" />
    </IconBase>
  );
}

export function IconUsers(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="8.6" r="3.1" />
      <path d="M4.5 19.25c.35-3.1 2.55-5 5.5-5 1.5 0 2.8.5 3.8 1.4" />
      <path d="M17.75 13.75v4.5M15.5 16h4.5" />
    </IconBase>
  );
}

export function IconTeams(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="7.4" r="2.6" />
      <path d="M8.1 19.25c.3-2.6 1.9-4.15 3.9-4.15s3.6 1.55 3.9 4.15" />
      <path d="M17 6.1a2.2 2.2 0 0 1 .6 4.3M19 12.9c1.3.5 2.05 1.6 2.25 3.35" />
      <path d="M7 6.1a2.2 2.2 0 0 0-.6 4.3M5 12.9c-1.3.5-2.05 1.6-2.25 3.35" />
    </IconBase>
  );
}

export function IconRoles(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="8.4" cy="8.4" r="3.65" />
      <path d="m11 11 8.25 8.25" />
      <path d="m15.6 15.6 2.15-2.15M18.25 18.25l1.9-1.9" />
    </IconBase>
  );
}

export function IconAudit(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="5" y="4.5" width="14" height="15" rx="1.75" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </IconBase>
  );
}

export function IconSettings(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4.5 7h3M11.75 7h7.75M4.5 12h8.25M17.25 12h2.25M4.5 17h1M9.75 17h9.75" />
      <circle cx="9.5" cy="7" r="2.1" />
      <circle cx="15" cy="12" r="2.1" />
      <circle cx="7.5" cy="17" r="2.1" />
    </IconBase>
  );
}

export function IconReporting(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M5.5 19.25V13M10.25 19.25V8.5M15 19.25v-4.25M19.75 19.25V5.5" />
    </IconBase>
  );
}
